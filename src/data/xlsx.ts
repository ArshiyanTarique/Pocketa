/**
 * A minimal XLSX reader.
 *
 * An .xlsx file is a ZIP of XML. Between `DecompressionStream('deflate-raw')`
 * and `DOMParser`, everything needed is already in the platform — so this reads
 * spreadsheets without a 400 KB dependency, and is lazy-loaded so it costs
 * nothing until someone actually imports one.
 *
 * It handles what bank and budgeting exports actually contain: shared strings,
 * inline strings, numbers, and date cells (which Excel stores as serial numbers
 * and which must be recognised via the style table, or a date silently imports
 * as "45901").
 *
 * It does not handle encrypted workbooks or formulas — for those it reports a
 * clear failure rather than importing something wrong.
 */

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxError';
  }
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  offset: number;
  compressedSize: number;
}

function readU16(view: DataView, at: number): number {
  return view.getUint16(at, true);
}
function readU32(view: DataView, at: number): number {
  return view.getUint32(at, true);
}

/** Locate the End Of Central Directory record, scanning back from the tail. */
function findEocd(view: DataView): number {
  const maxComment = 0xffff;
  const start = Math.max(0, view.byteLength - maxComment - 22);
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (readU32(view, i) === 0x06054b50) return i;
  }
  throw new XlsxError('That file is not a valid .xlsx workbook.');
}

function readCentralDirectory(buffer: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buffer);
  const eocd = findEocd(view);
  const count = readU16(view, eocd + 10);
  let cursor = readU32(view, eocd + 16);

  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (readU32(view, cursor) !== 0x02014b50) break;
    const method = readU16(view, cursor + 10);
    const compressedSize = readU32(view, cursor + 20);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const localOffset = readU32(view, cursor + 42);
    const name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLength));

    entries.set(name, { name, method, offset: localOffset, compressedSize });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buffer);
  if (readU32(view, entry.offset) !== 0x04034b50) {
    throw new XlsxError('This workbook appears to be damaged.');
  }
  const nameLength = readU16(view, entry.offset + 26);
  const extraLength = readU16(view, entry.offset + 28);
  const dataStart = entry.offset + 30 + nameLength + extraLength;
  const raw = new Uint8Array(buffer, dataStart, entry.compressedSize);

  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method !== 8) {
    throw new XlsxError('This workbook uses a compression method Pocketa cannot read.');
  }
  if (typeof DecompressionStream !== 'function') {
    throw new XlsxError('This browser cannot decompress .xlsx files. Save the sheet as CSV instead.');
  }

  // Built from the bytes directly rather than via Blob.stream(), which is
  // missing in some embedded webviews and in jsdom.
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(raw);
      controller.close();
    },
  });
  const inflated = source.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(inflated).text();
}

// ---------------------------------------------------------------------------
// Spreadsheet
// ---------------------------------------------------------------------------

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new XlsxError('This workbook could not be read.');
  }
  return doc;
}

/** Built-in number formats that mean "date" or "time". */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function looksLikeDateFormat(code: string): boolean {
  // Strip quoted literals and colour/condition sections before sniffing.
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare) && !/^[^dmy]*$/i.test(bare);
}

/** Style index -> is this cell formatted as a date. */
function readDateStyles(doc: Document | null): Set<number> {
  const dateStyles = new Set<number>();
  if (!doc) return dateStyles;

  const customDateFormats = new Set<number>();
  for (const fmt of Array.from(doc.getElementsByTagName('numFmt'))) {
    const id = Number(fmt.getAttribute('numFmtId'));
    const code = fmt.getAttribute('formatCode') ?? '';
    if (Number.isFinite(id) && looksLikeDateFormat(code)) customDateFormats.add(id);
  }

  const cellXfs = doc.getElementsByTagName('cellXfs')[0];
  if (!cellXfs) return dateStyles;

  Array.from(cellXfs.getElementsByTagName('xf')).forEach((xf, index) => {
    const id = Number(xf.getAttribute('numFmtId') ?? '0');
    if (BUILTIN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dateStyles.add(index);
  });
  return dateStyles;
}

function readSharedStrings(doc: Document | null): string[] {
  if (!doc) return [];
  return Array.from(doc.getElementsByTagName('si')).map((si) =>
    Array.from(si.getElementsByTagName('t'))
      .map((t) => t.textContent ?? '')
      .join(''),
  );
}

/** "BC12" -> 54 (zero-based column index). */
function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

/**
 * Excel stores a date as days since 1899-12-30 (its leap-year bug included).
 * Converted here to the app's timezone-naive calendar string, never through a
 * local Date, so an import cannot shift a transaction by a day.
 */
export function serialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const days = Math.floor(serial);
  // 1899-12-30 is day 0; 25569 days from there to the unix epoch.
  const epochDays = days - 25569;
  const ms = epochDays * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface Sheet {
  name: string;
  rows: string[][];
}

/**
 * Read every sheet in a workbook as a grid of strings.
 *
 * Values come back as text because the importer's own parsers are stricter and
 * better-messaged than anything guessed here — the one exception being dates,
 * which must be resolved while the style information is still available.
 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<Sheet[]> {
  const entries = readCentralDirectory(buffer);

  const workbookEntry = entries.get('xl/workbook.xml');
  if (!workbookEntry) {
    throw new XlsxError('That file is not a spreadsheet Pocketa can read.');
  }

  const [workbookXml, sharedXml, stylesXml] = await Promise.all([
    readEntry(buffer, workbookEntry),
    entries.has('xl/sharedStrings.xml')
      ? readEntry(buffer, entries.get('xl/sharedStrings.xml')!)
      : Promise.resolve(null),
    entries.has('xl/styles.xml')
      ? readEntry(buffer, entries.get('xl/styles.xml')!)
      : Promise.resolve(null),
  ]);

  const shared = readSharedStrings(sharedXml ? parseXml(sharedXml) : null);
  const dateStyles = readDateStyles(stylesXml ? parseXml(stylesXml) : null);

  const names = Array.from(parseXml(workbookXml).getElementsByTagName('sheet')).map(
    (s, i) => s.getAttribute('name') ?? `Sheet${i + 1}`,
  );

  const sheetPaths = [...entries.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });

  if (sheetPaths.length === 0) throw new XlsxError('That workbook has no sheets.');

  const sheets: Sheet[] = [];
  for (const [i, path] of sheetPaths.entries()) {
    const xml = await readEntry(buffer, entries.get(path)!);
    sheets.push({ name: names[i] ?? `Sheet${i + 1}`, rows: readSheet(parseXml(xml), shared, dateStyles) });
  }
  return sheets;
}

function readSheet(doc: Document, shared: string[], dateStyles: Set<number>): string[][] {
  const rows: string[][] = [];

  for (const row of Array.from(doc.getElementsByTagName('row'))) {
    const cells: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const ref = cell.getAttribute('r') ?? '';
      const at = ref ? columnIndex(ref) : cells.length;
      const type = cell.getAttribute('t');
      const styleIndex = Number(cell.getAttribute('s') ?? '-1');

      let value = '';
      if (type === 's') {
        const index = Number(cell.getElementsByTagName('v')[0]?.textContent ?? '');
        value = shared[index] ?? '';
      } else if (type === 'inlineStr') {
        value = Array.from(cell.getElementsByTagName('t'))
          .map((t) => t.textContent ?? '')
          .join('');
      } else {
        const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
        // A date is a number until the style table says otherwise.
        if (raw && dateStyles.has(styleIndex)) {
          value = serialToDate(Number(raw)) ?? raw;
        } else {
          value = raw;
        }
      }

      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    rows.push(cells);
  }

  // Trailing blank rows are noise from the spreadsheet's used range.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

export function isXlsxFile(file: { name: string; type?: string }): boolean {
  return (
    /\.xlsx$/i.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

/** Old binary .xls is a different format entirely, and worth saying so. */
export function isLegacyXls(file: { name: string; type?: string }): boolean {
  return /\.xls$/i.test(file.name) || file.type === 'application/vnd.ms-excel';
}
