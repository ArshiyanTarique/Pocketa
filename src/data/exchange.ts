/**
 * Import and export.
 *
 * Imports never write directly. A file is parsed into rows, the user maps the
 * columns, Pocketa flags probable duplicates, and only then is anything
 * committed — the same confirm-before-write rule that governs AI parsing.
 */

import { parseAmount, formatMoney, toInputString } from '../core/money';
import { isValidDate, today, type CalendarDate } from '../core/dates';
import { dedupeHash } from '../core/ledger';
import { describeTransaction } from '../app/txnDisplay';
import type { Account, ID, Transaction } from '../core/types';

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/** A tolerant CSV reader: quoted fields, embedded commas and newlines, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const src = text.replace(/^﻿/, ''); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',' || c === ';' || c === '\t') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // handled by the \n branch
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell == null ? '' : String(cell);
          return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(','),
    )
    .join('\r\n');
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export type ColumnRole =
  | 'ignore'
  | 'date'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'description'
  | 'merchant'
  | 'category'
  | 'notes'
  | 'tags';

export interface ColumnMapping {
  [columnIndex: number]: ColumnRole;
}

const HEADER_HINTS: Array<[RegExp, ColumnRole]> = [
  [/^(date|txn date|transaction date|posted|value date|tarikh)$/i, 'date'],
  [/^(amount|value|amt|transaction amount)$/i, 'amount'],
  [/^(debit|withdrawal|paid out|dr|money out)$/i, 'debit'],
  [/^(credit|deposit|paid in|cr|money in)$/i, 'credit'],
  [/^(description|details|narration|particulars|reference|memo)$/i, 'description'],
  [/^(merchant|payee|vendor|beneficiary|to|counterparty)$/i, 'merchant'],
  [/^(category|type|classification)$/i, 'category'],
  [/^(notes?|comment|remarks)$/i, 'notes'],
  [/^(tags?|labels?)$/i, 'tags'],
];

/** Best-guess mapping from a header row, which the user can then correct. */
export function guessMapping(header: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  header.forEach((raw, i) => {
    const name = raw.trim();
    const hit = HEADER_HINTS.find(([pattern]) => pattern.test(name));
    mapping[i] = hit ? hit[1] : 'ignore';
  });
  return mapping;
}

export function looksLikeHeader(row: string[]): boolean {
  const numeric = row.filter((c) => /^-?[\d.,]+$/.test(c.trim())).length;
  const dated = row.filter((c) => parseFlexibleDate(c) != null).length;
  return numeric === 0 && dated === 0 && row.some((c) => c.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Date parsing for imports
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Read a date from a bank export.
 *
 * `dayFirst` matters: 03/04/2026 is 3 April in most of the world and 4 March in
 * the US. Pocketa asks rather than guessing, because silently shifting a
 * transaction by a month is exactly the kind of quiet corruption that must not
 * happen.
 */
export function parseFlexibleDate(input: string, dayFirst = true): CalendarDate | null {
  const s = input.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.slice(0, 10);
    return isValidDate(iso) ? iso : null;
  }

  const numeric = s.match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (numeric) {
    let [, a, b, c] = numeric;
    let year: number;
    let month: number;
    let day: number;

    if (a.length === 4) {
      year = Number(a);
      month = Number(b);
      day = Number(c);
    } else {
      year = Number(c.length === 2 ? `20${c}` : c);
      if (dayFirst) {
        day = Number(a);
        month = Number(b);
      } else {
        month = Number(a);
        day = Number(b);
      }
      // If the "month" cannot be a month, the file must use the other order.
      if (month > 12 && day <= 12) [day, month] = [month, day];
    }

    const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return isValidDate(candidate) ? candidate : null;
  }

  const named = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{2,4})/);
  if (named) {
    const month = MONTH_NAMES[named[2].slice(0, 3).toLowerCase()];
    if (month) {
      const year = Number(named[3].length === 2 ? `20${named[3]}` : named[3]);
      const candidate = `${year}-${String(month).padStart(2, '0')}-${String(Number(named[1])).padStart(2, '0')}`;
      return isValidDate(candidate) ? candidate : null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Building importable rows
// ---------------------------------------------------------------------------

export interface ImportRow {
  index: number;
  date: CalendarDate | null;
  /** Signed: negative is money out. */
  amount: number | null;
  description: string;
  merchant: string | null;
  categoryHint: string | null;
  notes: string | null;
  tags: string[];
  raw: string[];
  /** Populated when the row cannot be imported as it stands. */
  problem: string | null;
  duplicateOf: ID | null;
  include: boolean;
}

export interface BuildRowsOptions {
  rows: string[][];
  mapping: ColumnMapping;
  hasHeader: boolean;
  dayFirst: boolean;
  currency: string;
  /** Some exports put money out as a positive number in a Debit column. */
  invertAmount: boolean;
  accountId: ID;
  existing: readonly Transaction[];
}

export function buildImportRows(opts: BuildRowsOptions): ImportRow[] {
  const body = opts.hasHeader ? opts.rows.slice(1) : opts.rows;
  const roleIndex = (role: ColumnRole) =>
    Object.entries(opts.mapping)
      .filter(([, r]) => r === role)
      .map(([i]) => Number(i));

  const dateCols = roleIndex('date');
  const amountCols = roleIndex('amount');
  const debitCols = roleIndex('debit');
  const creditCols = roleIndex('credit');
  const descCols = roleIndex('description');
  const merchantCols = roleIndex('merchant');
  const categoryCols = roleIndex('category');
  const notesCols = roleIndex('notes');
  const tagCols = roleIndex('tags');

  const existingHashes = new Map<string, ID>();
  for (const t of opts.existing) {
    if (t.voided) continue;
    if (t.dedupeHash) existingHashes.set(t.dedupeHash, t.id);
  }

  const seenInFile = new Set<string>();

  return body.map((raw, i) => {
    const cell = (cols: number[]) => cols.map((c) => raw[c] ?? '').find((v) => v.trim() !== '') ?? '';

    const date = dateCols.length ? parseFlexibleDate(cell(dateCols), opts.dayFirst) : null;

    let amount: number | null = null;
    if (amountCols.length) {
      const parsed = parseAmount(cell(amountCols), opts.currency);
      if (parsed.ok) amount = parsed.minor;
    }
    if (amount == null && (debitCols.length || creditCols.length)) {
      const debitRaw = cell(debitCols);
      const creditRaw = cell(creditCols);
      const debit = debitRaw ? parseAmount(debitRaw, opts.currency) : null;
      const credit = creditRaw ? parseAmount(creditRaw, opts.currency) : null;
      if (debit?.ok && debit.minor !== 0) amount = -Math.abs(debit.minor);
      else if (credit?.ok && credit.minor !== 0) amount = Math.abs(credit.minor);
    }
    if (amount != null && opts.invertAmount) amount = -amount;

    const description = cell(descCols).trim();
    const merchant = (cell(merchantCols) || description).trim() || null;
    const tagsRaw = cell(tagCols).trim();

    let problem: string | null = null;
    if (!date) problem = 'No readable date';
    else if (amount == null) problem = 'No readable amount';
    else if (amount === 0) problem = 'Amount is zero';

    const hash =
      date && amount != null
        ? dedupeHash({ date, amount, accountId: opts.accountId, merchant })
        : null;

    let duplicateOf: ID | null = null;
    if (hash) {
      if (existingHashes.has(hash)) duplicateOf = existingHashes.get(hash)!;
      else if (seenInFile.has(hash)) duplicateOf = 'in-file';
      seenInFile.add(hash);
    }

    return {
      index: i,
      date,
      amount,
      description,
      merchant,
      categoryHint: cell(categoryCols).trim() || null,
      notes: cell(notesCols).trim() || null,
      tags: tagsRaw ? tagsRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) : [],
      raw,
      problem,
      duplicateOf,
      include: problem == null && duplicateOf == null,
    };
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export interface ExportContext {
  accounts: ReadonlyMap<ID, Account>;
  baseCurrency: string;
}

export function transactionsToCsv(txns: readonly Transaction[], ctx: ExportContext): string {
  const header = [
    'Date', 'Type', 'Description', 'Merchant', 'Category', 'Account',
    'Amount', 'Currency', 'Amount (base)', 'Base currency', 'Tags', 'Notes', 'Deleted', 'ID',
  ];

  const rows = txns.map((t) => {
    const d = describeTransaction(t, ctx.accounts);
    const signed = d.direction === 'out' ? -d.amount : d.amount;
    const native = t.postings.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0);
    return [
      t.date,
      d.kindLabel,
      d.title,
      t.merchant ?? '',
      d.categoryNames.join(' | '),
      d.accountNames.join(' | '),
      toInputString(d.direction === 'out' ? -native : native, t.currency),
      t.currency,
      toInputString(signed, ctx.baseCurrency),
      ctx.baseCurrency,
      t.tags.join(' '),
      t.notes ?? '',
      t.voided ? 'yes' : '',
      t.id,
    ];
  });

  return toCsv([header, ...rows]);
}

/**
 * A spreadsheet-readable export.
 *
 * Written as SpreadsheetML rather than binary XLSX so it needs no library and
 * no build-time dependency, and opens correctly in Excel, Numbers and Sheets.
 */
export function transactionsToExcelXml(txns: readonly Transaction[], ctx: ExportContext): string {
  const escape = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const header = ['Date', 'Type', 'Description', 'Merchant', 'Category', 'Account', 'Amount', 'Currency', 'Tags', 'Notes'];

  const headerCells = header
    .map((h) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${escape(h)}</Data></Cell>`)
    .join('');

  const bodyRows = txns
    .map((t) => {
      const d = describeTransaction(t, ctx.accounts);
      const native = t.postings.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0);
      const signed = d.direction === 'out' ? -native : native;
      const cells = [
        `<Cell ss:StyleID="date"><Data ss:Type="String">${t.date}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escape(d.kindLabel)}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escape(d.title)}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escape(t.merchant ?? '')}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escape(d.categoryNames.join(' | '))}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escape(d.accountNames.join(' | '))}</Data></Cell>`,
        `<Cell ss:StyleID="num"><Data ss:Type="Number">${toInputString(signed, t.currency)}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escape(t.currency)}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escape(t.tags.join(' '))}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${escape(t.notes ?? '')}</Data></Cell>`,
      ].join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EFEFEF" ss:Pattern="Solid"/></Style>
  <Style ss:ID="num"><NumberFormat ss:Format="#,##0.00"/></Style>
  <Style ss:ID="date"><NumberFormat ss:Format="yyyy-mm-dd"/></Style>
 </Styles>
 <Worksheet ss:Name="Transactions">
  <Table>
   <Row>${headerCells}</Row>
   ${bodyRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

// ---------------------------------------------------------------------------
// PDF-ready report
// ---------------------------------------------------------------------------

export interface ReportInput {
  title: string;
  periodLabel: string;
  generatedAt: string;
  baseCurrency: string;
  summary: { income: number; expenses: number; savings: number; savingsRate: number | null };
  netWorth: { assets: number; liabilities: number; net: number };
  categories: Array<{ name: string; amount: number }>;
  accounts: Array<{ name: string; balance: number; currency: string }>;
  transactions: Array<{ date: string; title: string; category: string; amount: number }>;
}

/**
 * A self-contained HTML report, styled for print.
 *
 * Printing to PDF is the browser's job and it does it well, so this avoids
 * bundling a PDF engine while still producing a document that looks deliberate
 * on paper.
 */
export function buildReportHtml(input: ReportInput): string {
  const money = (v: number, currency = input.baseCurrency) => formatMoney(v, currency);
  const escape = (v: string) => v.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

  const categoryRows = input.categories
    .map((c) => `<tr><td>${escape(c.name)}</td><td class="num">${money(c.amount)}</td></tr>`)
    .join('');

  const accountRows = input.accounts
    .map((a) => `<tr><td>${escape(a.name)}</td><td class="num">${money(a.balance, a.currency)}</td></tr>`)
    .join('');

  const txnRows = input.transactions
    .map(
      (t) =>
        `<tr><td class="date">${t.date}</td><td>${escape(t.title)}</td><td>${escape(t.category)}</td><td class="num">${money(t.amount)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escape(input.title)}</title>
<style>
  @page { margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #16191C; margin: 0; font-size: 11pt; line-height: 1.5; }
  header { border-bottom: 2px solid #16191C; padding-bottom: 12px; margin-bottom: 24px; }
  h1 { font-size: 20pt; margin: 0 0 4px; letter-spacing: -0.02em; }
  .meta { color: #71767D; font-size: 9pt; }
  h2 { font-size: 12pt; margin: 26px 0 8px; letter-spacing: -0.01em; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.07em; color: #71767D; border-bottom: 1px solid #D2CCC3; padding: 6px 4px; font-weight: 600; }
  td { padding: 5px 4px; border-bottom: 1px solid #EFEDE9; }
  .num { text-align: right; font-variant-numeric: tabular-nums; font-family: ui-monospace, "SF Mono", Menlo, monospace; white-space: nowrap; }
  .date { font-variant-numeric: tabular-nums; font-family: ui-monospace, Menlo, monospace; color: #4A4F55; white-space: nowrap; }
  .totals td { border-bottom: none; padding-top: 8px; }
  .totals tr:last-child td { border-top: 1.5px solid #16191C; font-weight: 700; padding-top: 8px; }
  footer { margin-top: 32px; padding-top: 10px; border-top: 1px solid #D2CCC3; color: #71767D; font-size: 8.5pt; }
  @media print { .no-print { display: none; } }
</style></head>
<body>
<header>
  <h1>${escape(input.title)}</h1>
  <p class="meta">${escape(input.periodLabel)} · generated ${escape(input.generatedAt)}</p>
</header>

<h2>Summary</h2>
<table class="totals">
  <tr><td>Income</td><td class="num">${money(input.summary.income)}</td></tr>
  <tr><td>Expenses</td><td class="num">−${money(input.summary.expenses)}</td></tr>
  <tr><td>${input.summary.savings >= 0 ? 'Saved' : 'Overspent'}</td><td class="num">${money(input.summary.savings)}</td></tr>
</table>

<h2>Net worth</h2>
<table class="totals">
  <tr><td>Assets</td><td class="num">${money(input.netWorth.assets)}</td></tr>
  <tr><td>Liabilities</td><td class="num">−${money(input.netWorth.liabilities)}</td></tr>
  <tr><td>Net worth</td><td class="num">${money(input.netWorth.net)}</td></tr>
</table>

<h2>Accounts</h2>
<table><thead><tr><th>Account</th><th class="num">Balance</th></tr></thead><tbody>${accountRows}</tbody></table>

<h2>Spending by category</h2>
<table><thead><tr><th>Category</th><th class="num">Amount</th></tr></thead><tbody>${categoryRows}</tbody></table>

<h2>Transactions</h2>
<table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>${txnRows}</tbody></table>

<footer>
  Produced by Pocketa. Figures are derived from recorded transactions and are not financial advice.
</footer>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

export type Delivery = 'shared' | 'downloaded' | 'cancelled';

/**
 * Can this device hand a file to another app?
 *
 * Asked with a real file, because support for sharing a link says nothing about
 * support for sharing a file. Used only to label a button honestly — the
 * delivery itself re-checks and falls back on its own.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([''], 'probe.txt', { type: 'text/plain' })] });
  } catch {
    return false;
  }
}

/**
 * Hand a file to the person, by whatever route their device actually has.
 *
 * On a phone the share sheet is the right answer and a download is not: a file
 * dropped into Downloads is one the user then has to go and find, and moving it
 * anywhere useful is a separate chore. The sheet puts Drive, WhatsApp, Gmail and
 * Files one tap away — and sending a carpool bill straight to the person who
 * owes it is worth more than any single destination.
 *
 * Desktop browsers mostly cannot share files, and a download there is already
 * the expected thing, so that is the fallback rather than the failure.
 *
 * A cancelled share is NOT a failure and must not fall back: someone who
 * dismissed the sheet has said no, and answering that by silently writing the
 * file to Downloads is the opposite of what they asked.
 */
export async function deliverFile(filename: string, blob: Blob): Promise<Delivery> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });

  // `canShare` must be asked about the actual files: support for sharing text
  // says nothing about support for sharing a file.
  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Anything else — a share target that failed, a gesture that expired —
      // still leaves the person wanting their file.
      downloadBlob(filename, blob);
      return 'downloaded';
    }
  }

  downloadBlob(filename, blob);
  return 'downloaded';
}

/** Text exports, delivered the same way. */
export function deliverText(filename: string, content: string, mime: string): Promise<Delivery> {
  return deliverFile(filename, new Blob([content], { type: `${mime};charset=utf-8` }));
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save an already-built Blob, for binary or compressed exports. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function timestampedName(base: string, extension: string): string {
  return `${base}-${today()}.${extension}`;
}
