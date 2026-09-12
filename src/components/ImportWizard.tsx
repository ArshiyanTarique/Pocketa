import * as React from 'react';
import { CircleAlert, Copy, FileUp, Check } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button, Badge, Notice, EmptyState } from '../ui/primitives';
import { Money } from '../ui/Money';
import { Field, Select, Toggle } from '../ui/fields';
import { toast } from '../ui/toast';
import { cn } from '../ui/cn';
import { useFlatCategories, useSpendableAccounts } from '../app/useLedger';
import { useStore } from '../store/useStore';
import {
  buildImportRows,
  guessMapping,
  looksLikeHeader,
  parseCsv,
  type ColumnMapping,
  type ColumnRole,
  type ImportRow } from '../data/exchange';
import { dedupeHash } from '../core/ledger';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import type { TxnDraft } from '../core/draft';
import type { ID } from '../core/types';

const ROLES: Array<{ value: ColumnRole; label: string }> = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'date', label: 'Date' },
  { value: 'amount', label: 'Amount (signed)' },
  { value: 'debit', label: 'Money out' },
  { value: 'credit', label: 'Money in' },
  { value: 'description', label: 'Description' },
  { value: 'merchant', label: 'Merchant' },
  { value: 'category', label: 'Category' },
  { value: 'notes', label: 'Notes' },
  { value: 'tags', label: 'Tags' },
];

type Step = 'file' | 'map' | 'review' | 'done';

export function ImportWizard({ onClose }: { onClose: () => void }) {
  const accounts = useSpendableAccounts();
  const categories = useFlatCategories('expense_category');
  const incomeCategories = useFlatCategories('income_category');
  const transactions = useStore((s) => s.transactions);
  const createTransactions = useStore((s) => s.createTransactions);
  const settings = useStore((s) => s.settings);

  const [step, setStep] = React.useState<Step>('file');
  const [fileName, setFileName] = React.useState('');
  const [grid, setGrid] = React.useState<string[][]>([]);
  const [sheets, setSheets] = React.useState<Array<{ name: string; rows: string[][] }>>([]);
  const [sheetIndex, setSheetIndex] = React.useState(0);
  const [mapping, setMapping] = React.useState<ColumnMapping>({});
  const [hasHeader, setHasHeader] = React.useState(true);
  const [dayFirst, setDayFirst] = React.useState(true);
  const [invertAmount, setInvertAmount] = React.useState(false);
  const [accountId, setAccountId] = React.useState<ID>(accounts[0]?.id ?? '');
  const [fallbackCategory, setFallbackCategory] = React.useState<ID>('');
  const [fallbackIncome, setFallbackIncome] = React.useState<ID>('');
  const [rows, setRows] = React.useState<ImportRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ created: number; skipped: number; failed: number } | null>(null);

  React.useEffect(() => {
    if (categories.length && !fallbackCategory) setFallbackCategory(categories[0].id);
    if (incomeCategories.length && !fallbackIncome) setFallbackIncome(incomeCategories[0].id);
  }, [categories, incomeCategories, fallbackCategory, fallbackIncome]);

  async function onFile(file: File) {
    setFileName(file.name);
    const { isXlsxFile, isLegacyXls } = await import('../data/xlsx');

    if (isLegacyXls(file)) {
      toast.error(
        'That is the older .xls format',
        'Open it and save as .xlsx or .csv, then try again.',
      );
      return;
    }

    let parsed: string[][];
    if (isXlsxFile(file)) {
      try {
        const { parseXlsx } = await import('../data/xlsx');
        const book = await parseXlsx(await file.arrayBuffer());
        const usable = book.filter((sheet) => sheet.rows.length > 0);
        if (usable.length === 0) {
          toast.error('That workbook has no rows Pocketa can read.');
          return;
        }
        setSheets(usable);
        setSheetIndex(0);
        parsed = usable[0].rows;
      } catch (err) {
        toast.error(
          'That workbook could not be read',
          err instanceof Error ? err.message : undefined,
        );
        return;
      }
    } else {
      setSheets([]);
      parsed = parseCsv(await file.text());
      if (parsed.length === 0) {
        toast.error('That file has no rows Pocketa can read.');
        return;
      }
    }

    applyGrid(parsed);
    setStep('map');
  }

  /** Set the working grid and guess the column mapping for it. */
  function applyGrid(parsed: string[][]) {
    setGrid(parsed);
    const header = looksLikeHeader(parsed[0]);
    setHasHeader(header);
    setMapping(guessMapping(header ? parsed[0] : parsed[0].map((_, i) => `Column ${i + 1}`)));
  }

  function preview() {
    setRows(
      buildImportRows({
        rows: grid,
        mapping,
        hasHeader,
        dayFirst,
        currency: settings.baseCurrency,
        invertAmount,
        accountId,
        existing: transactions }),
    );
    setStep('review');
  }

  async function commit() {
    setBusy(true);
    const chosen = rows.filter((r) => r.include && r.problem == null);
    const batchId = newId('imp');

    const drafts: TxnDraft[] = chosen.map((row) => {
      const isIncome = (row.amount ?? 0) > 0;
      const magnitude = Math.abs(row.amount ?? 0);
      const matched = matchCategory(row.categoryHint, isIncome ? incomeCategories : categories);
      const categoryId = matched ?? (isIncome ? fallbackIncome : fallbackCategory);

      const base = {
        date: row.date!,
        merchant: row.merchant,
        notes: row.notes ?? (row.description !== row.merchant ? row.description || null : null),
        tags: row.tags,
        importBatchId: batchId,
        dedupeHash: dedupeHash({
          date: row.date!,
          amount: row.amount!,
          accountId,
          merchant: row.merchant }) };

      return isIncome
        ? { ...base, type: 'earn' as const, accountId, allocations: [{ categoryId, amount: magnitude }] }
        : { ...base, type: 'spend' as const, accountId, allocations: [{ categoryId, amount: magnitude }] };
    });

    const outcome = await createTransactions(drafts, {
      id: batchId,
      source: 'csv',
      fileName,
      rowCount: rows.length,
      importedCount: 0,
      skippedCount: 0,
      accountId,
      createdAt: nowIso() });

    setBusy(false);
    setResult({
      created: outcome.created.length,
      skipped: rows.length - chosen.length,
      failed: outcome.failed.length });
    setStep('done');
  }

  const includable = rows.filter((r) => r.problem == null);
  const duplicates = rows.filter((r) => r.duplicateOf != null);
  const problems = rows.filter((r) => r.problem != null);
  const selected = rows.filter((r) => r.include && r.problem == null);
  const headerRow = hasHeader ? grid[0] : grid[0]?.map((_, i) => `Column ${i + 1}`) ?? [];
  const mappedRoles = Object.values(mapping);
  const canPreview =
    !!accountId &&
    mappedRoles.includes('date') &&
    (mappedRoles.includes('amount') || mappedRoles.includes('debit') || mappedRoles.includes('credit'));

  return (
    <Sheet
      open
      onClose={onClose}
      title="Import transactions"
      description={step === 'file' ? 'From a CSV or Excel file your bank or another app exported.' : fileName}
      size="xl"
      footer={
        step === 'map' ? (
          <div className="flex gap-2.5">
            <Button variant="secondary" onClick={() => setStep('file')}>Back</Button>
            <Button variant="primary" full onClick={preview} disabled={!canPreview}>
              Preview {grid.length - (hasHeader ? 1 : 0)} rows
            </Button>
          </div>
        ) : step === 'review' ? (
          <div className="flex gap-2.5">
            <Button variant="secondary" onClick={() => setStep('map')}>Back</Button>
            <Button variant="primary" full loading={busy} onClick={() => void commit()} disabled={selected.length === 0}>
              Import {selected.length} transaction{selected.length === 1 ? '' : 's'}
            </Button>
          </div>
        ) : step === 'done' ? (
          <Button variant="primary" full onClick={onClose}>Done</Button>
        ) : undefined
      }
    >
      {step === 'file' && <FileStep onFile={onFile} />}

      {step === 'map' && (
        <div className="space-y-4 pb-2">
          <Notice tone="neutral">
            Check that each column is understood correctly. Nothing is imported until you have seen
            the preview.
          </Notice>

          {sheets.length > 1 && (
            <Field label="Sheet" hint="This workbook has more than one.">
              <Select
                value={String(sheetIndex)}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setSheetIndex(next);
                  applyGrid(sheets[next].rows);
                }}
              >
                {sheets.map((sheet, i) => (
                  <option key={sheet.name} value={i}>
                    {sheet.name} — {sheet.rows.length} rows
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Import into account">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value as ID)}>
                <option value="">Choose an account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date format" hint="03/04/2026 means different days in different countries.">
              <Select value={dayFirst ? 'dmy' : 'mdy'} onChange={(e) => setDayFirst(e.target.value === 'dmy')}>
                <option value="dmy">Day first — 03/04 is 3 April</option>
                <option value="mdy">Month first — 03/04 is 4 March</option>
              </Select>
            </Field>
          </div>

          <div className="space-y-2 rounded-[--radius] border border-line p-3">
            <Toggle checked={hasHeader} onChange={setHasHeader} label="First row is a header" />
            <Toggle
              checked={invertAmount}
              onChange={setInvertAmount}
              label="Flip the sign of every amount"
              description="Use this if spending shows as positive and income as negative."
            />
          </div>

          <div>
            <h3 className="eyebrow mb-2">Columns</h3>
            <div className="overflow-x-auto rounded-[--radius] border border-line">
              <table className="w-full text-left text-[0.8125rem]">
                <thead>
                  <tr className="border-b border-line bg-surface-2">
                    {headerRow.map((cell, i) => (
                      <th key={i} className="min-w-[10rem] p-2 align-top">
                        <p className="mb-1.5 truncate font-medium text-ink" title={cell}>{cell || `Column ${i + 1}`}</p>
                        <Select
                          value={mapping[i] ?? 'ignore'}
                          onChange={(e) => setMapping({ ...mapping, [i]: e.target.value as ColumnRole })}
                          className="h-8 text-xs"
                        >
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </Select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.slice(hasHeader ? 1 : 0, hasHeader ? 4 : 3).map((row, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      {headerRow.map((_, j) => (
                        <td key={j} className="max-w-[14rem] truncate p-2 text-ink-3" title={row[j]}>
                          {row[j]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!canPreview && (
            <Notice tone="warn">
              Map a date column and at least one amount column, and choose an account, before
              continuing.
            </Notice>
          )}
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4 pb-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Ready" value={selected.length} tone="positive" />
            <Stat label="Duplicates" value={duplicates.length} tone={duplicates.length ? 'warn' : 'neutral'} />
            <Stat label="Problems" value={problems.length} tone={problems.length ? 'negative' : 'neutral'} />
          </div>

          {duplicates.length > 0 && (
            <Notice tone="warn" icon={<Copy className="size-4" />} title="Possible duplicates found">
              {duplicates.length} row{duplicates.length === 1 ? '' : 's'} match something already in
              your ledger on date, amount, account and merchant. They are unticked by default — tick
              one only if it is genuinely a separate transaction.
            </Notice>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category for uncategorised expenses">
              <Select value={fallbackCategory} onChange={(e) => setFallbackCategory(e.target.value as ID)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.path}</option>
                ))}
              </Select>
            </Field>
            <Field label="Category for uncategorised income">
              <Select value={fallbackIncome} onChange={(e) => setFallbackIncome(e.target.value as ID)}>
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.path}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex items-center justify-between">
            <h3 className="eyebrow">Rows</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRows(rows.map((r) => ({ ...r, include: r.problem == null })))}>
                Select all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRows(rows.map((r) => ({ ...r, include: false })))}>
                Select none
              </Button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-[--radius] border border-line">
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.index}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-2.5',
                      row.problem && 'cursor-not-allowed opacity-55',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={row.include}
                      disabled={row.problem != null}
                      onChange={(e) =>
                        setRows(rows.map((r) => (r.index === row.index ? { ...r, include: e.target.checked } : r)))
                      }
                      className="size-4 shrink-0 accent-[--accent]"
                    />
                    <span className="tnum w-[5.5rem] shrink-0 text-xs text-ink-3">{row.date ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">
                      {row.merchant || row.description || <span className="text-ink-4">No description</span>}
                    </span>
                    {row.duplicateOf && <Badge tone="warn">Duplicate</Badge>}
                    {row.problem && <Badge tone="negative">{row.problem}</Badge>}
                    {row.amount != null && (
                      <Money
                        value={row.amount}
                        size="sm"
                        sign="always"
                        symbol={false}
                        tone={row.amount > 0 ? 'positive' : 'default'}
                        className="shrink-0"
                      />
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          {includable.length === 0 && (
            <Notice tone="negative" icon={<CircleAlert className="size-4" />}>
              No row could be read. Go back and check the column mapping and date format.
            </Notice>
          )}
        </div>
      )}

      {step === 'done' && result && (
        <div className="py-4">
          <EmptyState
            icon={<Check className="size-5 text-positive" />}
            title={`${result.created} transaction${result.created === 1 ? '' : 's'} imported`}
            body={
              [
                result.skipped > 0 ? `${result.skipped} skipped` : null,
                result.failed > 0 ? `${result.failed} could not be recorded` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Everything in the file was imported.'
            }
          />
        </div>
      )}
    </Sheet>
  );
}

function FileStep({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="pb-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className={cn(
          'flex flex-col items-center justify-center rounded-[--radius-lg] border-2 border-dashed px-6 py-14 text-center transition-colors',
          dragging ? 'border-accent bg-accent-soft' : 'border-line-strong',
        )}
      >
        <FileUp className="mb-3 size-7 text-ink-3" />
        <p className="text-[0.9375rem] font-semibold text-ink">Drop a CSV or Excel file here</p>
        <p className="mt-1 max-w-[38ch] text-[0.8125rem] leading-relaxed text-ink-3">
          You will map the columns and see a full preview before anything is added.
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => inputRef.current?.click()}>
          Choose a file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-4">
        Exports from most banks and finance apps work. Pocketa reads .xlsx workbooks directly, and
        CSVs using commas, semicolons or tabs. The older binary .xls format needs saving as .xlsx
        first.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'positive' | 'warn' | 'negative' | 'neutral' }) {
  const tones = {
    positive: 'text-positive',
    warn: 'text-warn',
    negative: 'text-negative',
    neutral: 'text-ink-3' };
  return (
    <div className="rounded-[--radius] border border-line px-3 py-2.5 text-center">
      <p className={cn('tnum text-xl font-semibold', tones[tone])}>{value}</p>
      <p className="mt-0.5 text-[0.6875rem] text-ink-4">{label}</p>
    </div>
  );
}

function matchCategory(
  hint: string | null,
  categories: Array<{ id: ID; name: string; path: string }>,
): ID | null {
  if (!hint) return null;
  const needle = hint.trim().toLowerCase();
  if (!needle) return null;
  return (
    categories.find((c) => c.name.toLowerCase() === needle)?.id ??
    categories.find((c) => c.path.toLowerCase().includes(needle))?.id ??
    null
  );
}
