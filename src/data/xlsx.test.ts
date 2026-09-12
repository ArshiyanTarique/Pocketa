// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseXlsx, serialToDate, isXlsxFile, isLegacyXls, XlsxError } from './xlsx';

// ---------------------------------------------------------------------------
// A minimal ZIP writer, so these tests run against real file bytes rather than
// a mocked reader. Entries are stored uncompressed except where a test asks for
// deflate, which exercises the DecompressionStream path.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function makeZip(
  files: Record<string, string>,
  opts: { compress?: boolean } = {},
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const raw = encoder.encode(content) as Uint8Array<ArrayBuffer>;
    const method = opts.compress ? 8 : 0;
    const data = opts.compress ? await deflateRaw(raw) : raw;
    const nameBytes = encoder.encode(name);
    const crc = crc32(raw);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    chunks.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, eocd];
  const total = all.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

// ---------------------------------------------------------------------------

const WORKBOOK = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Statement" sheetId="1"/></sheets></workbook>`;

const SHARED = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
<si><t>Date</t></si><si><t>Description</t></si><si><t>Amount</t></si><si><t>Imtiaz, Karachi</t></si></sst>`;

// Style index 1 uses numFmtId 14 — a built-in date format.
const STYLES = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts></styleSheet>`;

const SHEET = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2" s="1"><v>46266</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>-2400.5</v></c></row>
<row r="3"><c r="A3" s="2"><v>46267</v></c><c r="B3" t="inlineStr"><is><t>Shell</t></is></c><c r="C3"><v>-6800</v></c></row>
<row r="4"><c r="A4" s="1"><v>46268</v></c><c r="C4"><v>285000</v></c></row>
</sheetData></worksheet>`;

function workbook(overrides: Record<string, string> = {}) {
  return {
    'xl/workbook.xml': WORKBOOK,
    'xl/sharedStrings.xml': SHARED,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': SHEET,
    ...overrides,
  };
}

describe('reading a workbook', () => {
  it('reads headers, shared strings, inline strings and numbers', async () => {
    const sheets = await parseXlsx(await makeZip(workbook()));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Statement');

    const rows = sheets[0].rows;
    expect(rows[0]).toEqual(['Date', 'Description', 'Amount']);
    expect(rows[1][1]).toBe('Imtiaz, Karachi'); // shared string with a comma
    expect(rows[1][2]).toBe('-2400.5');
    expect(rows[2][1]).toBe('Shell'); // inline string
  });

  it('resolves date cells via the style table rather than importing a serial', async () => {
    const sheets = await parseXlsx(await makeZip(workbook()));
    const rows = sheets[0].rows;
    // Built-in format 14 and a custom dd/mm/yyyy must both be recognised.
    expect(rows[1][0]).toBe('2026-09-01');
    expect(rows[2][0]).toBe('2026-09-02');
    expect(rows[3][0]).toBe('2026-09-03');
  });

  it('keeps a numeric cell numeric when it is not styled as a date', async () => {
    const sheets = await parseXlsx(await makeZip(workbook()));
    expect(sheets[0].rows[3][2]).toBe('285000');
  });

  it('pads gaps so a missing cell does not shift the columns', async () => {
    const sheets = await parseXlsx(await makeZip(workbook()));
    // Row 4 has no description; the amount must stay in column C.
    expect(sheets[0].rows[3]).toHaveLength(3);
    expect(sheets[0].rows[3][1]).toBe('');
    expect(sheets[0].rows[3][2]).toBe('285000');
  });

  it('reads deflate-compressed entries, which is what Excel actually writes', async () => {
    const sheets = await parseXlsx(await makeZip(workbook(), { compress: true }));
    expect(sheets[0].rows[0]).toEqual(['Date', 'Description', 'Amount']);
    expect(sheets[0].rows[1][0]).toBe('2026-09-01');
  });

  it('works without a shared strings table', async () => {
    const noShared = workbook();
    delete (noShared as Record<string, string>)['xl/sharedStrings.xml'];
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Only inline</t></is></c></row></sheetData></worksheet>`;
    const sheets = await parseXlsx(await makeZip({ ...noShared, 'xl/worksheets/sheet1.xml': sheet }));
    expect(sheets[0].rows[0][0]).toBe('Only inline');
  });

  it('drops trailing blank rows from the used range', async () => {
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Real</t></is></c></row>
      <row r="2"><c r="A2"><v></v></c></row>
      <row r="3"><c r="A3"><v></v></c></row></sheetData></worksheet>`;
    const sheets = await parseXlsx(await makeZip(workbook({ 'xl/worksheets/sheet1.xml': sheet })));
    expect(sheets[0].rows).toHaveLength(1);
  });

  it('reads every sheet in the book, in order', async () => {
    const second = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Second sheet</t></is></c></row></sheetData></worksheet>`;
    const book = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets>
      <sheet name="One" sheetId="1"/><sheet name="Two" sheetId="2"/></sheets></workbook>`;
    const sheets = await parseXlsx(
      await makeZip(workbook({ 'xl/workbook.xml': book, 'xl/worksheets/sheet2.xml': second })),
    );
    expect(sheets.map((s) => s.name)).toEqual(['One', 'Two']);
    expect(sheets[1].rows[0][0]).toBe('Second sheet');
  });
});

describe('refusing what it cannot read', () => {
  it('rejects a file that is not a zip', async () => {
    const notAZip = new TextEncoder().encode('just some text, definitely not a spreadsheet').buffer;
    await expect(parseXlsx(notAZip)).rejects.toThrow(XlsxError);
  });

  it('rejects a zip that is not a workbook', async () => {
    const zip = await makeZip({ 'readme.txt': 'hello' });
    await expect(parseXlsx(zip)).rejects.toThrow(/not a spreadsheet/i);
  });

  it('rejects a workbook with no sheets', async () => {
    const zip = await makeZip({ 'xl/workbook.xml': WORKBOOK });
    await expect(parseXlsx(zip)).rejects.toThrow(/no sheets/i);
  });
});

describe('serial dates', () => {
  it('converts Excel serials without going through a local Date', () => {
    expect(serialToDate(46266)).toBe('2026-09-01');
    expect(serialToDate(25569)).toBe('1970-01-01'); // the unix epoch
    expect(serialToDate(1)).toBe('1899-12-31');
  });

  it('refuses values outside the representable range', () => {
    expect(serialToDate(0)).toBeNull();
    expect(serialToDate(-5)).toBeNull();
    expect(serialToDate(9_999_999)).toBeNull();
    expect(serialToDate(Number.NaN)).toBeNull();
  });
});

describe('file detection', () => {
  it('recognises xlsx by name and by mime type', () => {
    expect(isXlsxFile({ name: 'statement.xlsx' })).toBe(true);
    expect(isXlsxFile({ name: 'x', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe(true);
    expect(isXlsxFile({ name: 'statement.csv' })).toBe(false);
  });

  it('distinguishes the old binary .xls, which is a different format', () => {
    expect(isLegacyXls({ name: 'statement.xls' })).toBe(true);
    expect(isLegacyXls({ name: 'statement.xlsx' })).toBe(false);
  });
});
