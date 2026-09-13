import * as React from 'react';
import {
  Filter,
  History,
  Pencil,
  Search,
  Trash2,
  X,
  RotateCcw,
  Link2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Badge, Button, EmptyState, Notice, Segmented } from '../ui/primitives';
import { Money } from '../ui/Money';
import { Reckoning } from '../ui/Reckoning';
import { Sheet, Confirm } from '../ui/Sheet';
import { Select, TextInput, Field, DateInput } from '../ui/fields';
import { TransactionRow } from '../components/TransactionRow';
import { useIncremental } from '../ui/useIncremental';
import { AttachmentStrip } from '../components/Attachments';
import { toast } from '../ui/toast';
import { cn } from '../ui/cn';
import { navigate, useRoute } from '../app/router';
import { useAccountMap, useFlatCategories, useSpendableAccounts, useToday } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { describeTransaction, signedAmount } from '../app/txnDisplay';
import { groupByDate, live } from '../core/projections';
import { formatDate, formatRelativeDay, monthRange, today } from '../core/dates';
import { sumMinor } from '../core/money';
import { historyFor, type Op } from '../data/oplog';
import { TXN_KIND_LABELS, type ID, type Transaction, type TxnKind } from '../core/types';

type Scope = 'all' | 'expense' | 'income' | 'transfer';

export function Transactions({ onEdit }: { onEdit: (id: string) => void }) {
  const route = useRoute();
  const accounts = useAccountMap();
  const transactions = useStore((s) => s.transactions);
  const settings = useStore((s) => s.settings);
  const asOf = useToday();
  const hidden = settings.hideAmounts;

  const [query, setQuery] = React.useState(() => route.query.get('q') ?? '');
  const [scope, setScope] = React.useState<Scope>('all');
  const [showFilters, setShowFilters] = React.useState(false);
  const [categoryId, setCategoryId] = React.useState<ID | ''>(() => (route.query.get('category') as ID) ?? '');
  const [accountId, setAccountId] = React.useState<ID | ''>(() => (route.query.get('account') as ID) ?? '');
  const [tag, setTag] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [includeVoided, setIncludeVoided] = React.useState(false);
  const [detailId, setDetailId] = React.useState<ID | null>(route.segment);

  React.useEffect(() => {
    setDetailId(route.segment);
    const c = route.query.get('category');
    if (c) setCategoryId(c as ID);
    const q = route.query.get('q');
    if (q) setQuery(q);
  }, [route.segment, route.query]);

  const categories = useFlatCategories('expense_category');
  const incomeCategories = useFlatCategories('income_category');
  const spendable = useSpendableAccounts(true);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (includeVoided ? transactions : live(transactions))
      .filter((t) => {
        if (scope === 'expense' && t.kind !== 'expense') return false;
        if (scope === 'income' && t.kind !== 'income') return false;
        if (scope === 'transfer' && !['transfer', 'cc_payment', 'goal_contribution', 'goal_withdrawal', 'lend', 'borrow', 'repay_in', 'repay_out'].includes(t.kind)) return false;
        if (categoryId && !t.postings.some((p) => p.accountId === categoryId)) return false;
        if (accountId && !t.postings.some((p) => p.accountId === accountId)) return false;
        if (tag && !t.tags.some((x) => x.toLowerCase() === tag.toLowerCase())) return false;
        if (from && t.date < from) return false;
        if (to && t.date > to) return false;
        if (!needle) return true;

        const d = describeTransaction(t, accounts);
        return (
          d.title.toLowerCase().includes(needle) ||
          d.subtitle.toLowerCase().includes(needle) ||
          (t.notes ?? '').toLowerCase().includes(needle) ||
          t.tags.some((x) => x.toLowerCase().includes(needle)) ||
          d.categoryNames.some((c) => c.toLowerCase().includes(needle)) ||
          d.accountNames.some((a) => a.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [transactions, query, scope, categoryId, accountId, tag, from, to, includeVoided, accounts]);

  // Only the visible window is grouped and rendered. Totals above still use
  // the full filtered set, so paging never changes a figure.
  const list = useIncremental(filtered.length, 60);
  const groups = React.useMemo(
    () => groupByDate(filtered.slice(0, list.count)),
    [filtered, list.count],
  );

  const totals = React.useMemo(() => {
    let spent = 0;
    let earned = 0;
    for (const t of filtered) {
      if (t.voided) continue;
      for (const p of t.postings) {
        const cls = accounts.get(p.accountId)?.class;
        if (cls === 'expense_category') spent += p.baseAmount;
        if (cls === 'income_category') earned -= p.baseAmount;
      }
    }
    return { spent, earned, net: earned - spent };
  }, [filtered, accounts]);

  const activeFilters = [categoryId, accountId, tag, from, to].filter(Boolean).length;

  /**
   * Days are headings, not cards. A list of transactions is a list; wrapping
   * each day in its own box turned one list into thirty boxes and made the
   * screen read as clutter before a single row was read.
   */
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="pl-9"
              aria-label="Search transactions"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button
            variant={activeFilters > 0 ? 'quiet' : 'secondary'}
            icon={<Filter className="size-4" />}
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            {activeFilters > 0 ? String(activeFilters) : 'Filter'}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Segmented
            label="Filter transactions"
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All' },
              { value: 'expense', label: 'Out' },
              { value: 'income', label: 'In' },
              { value: 'transfer', label: 'Moved' },
            ]}
          />
          {/* The count carries the totals as its tooltip rather than as a
              permanent three-figure strip: they restate what is on screen. */}
          <span
            className="tnum shrink-0 text-xs text-ink-4"
            title={hidden ? undefined : `Out ${totals.spent / 100} · In ${totals.earned / 100} · Net ${totals.net / 100}`}
          >
            {filtered.length}
          </span>
        </div>

        <div className="disclose" data-open={showFilters || undefined}>
          <div>
            <div className="space-y-3 border-t border-line pt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Category">
                  <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value as ID)}>
                    <option value="">Any category</option>
                    <optgroup label="Expenses">
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.path}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Income">
                      {incomeCategories.map((c) => (
                        <option key={c.id} value={c.id}>{c.path}</option>
                      ))}
                    </optgroup>
                  </Select>
                </Field>
                <Field label="Account">
                  <Select value={accountId} onChange={(e) => setAccountId(e.target.value as ID)}>
                    <option value="">Any account</option>
                    {spendable.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archived)' : ''}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="From">
                  <DateInput value={from} onChange={setFrom} />
                </Field>
                <Field label="To">
                  <DateInput value={to} onChange={setTo} />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const r = monthRange(today());
                    setFrom(r.from);
                    setTo(r.to);
                  }}
                >
                  This month
                </Button>
                <Button
                  size="sm"
                  variant={includeVoided ? 'quiet' : 'secondary'}
                  onClick={() => setIncludeVoided((v) => !v)}
                >
                  {includeVoided ? 'Hiding nothing' : 'Show deleted'}
                </Button>
                {activeFilters > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCategoryId('');
                      setAccountId('');
                      setTag('');
                      setFrom('');
                      setTo('');
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<Search className="size-5" />}
          title={query || activeFilters > 0 ? 'Nothing matches' : 'No transactions yet'}
          action={
            query || activeFilters > 0 ? (
              <Button size="sm" variant="secondary" onClick={() => { setQuery(''); setScope('all'); }}>
                Clear search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Filtering animates: rows that stay slide to their new place, rows
              that go fade, so the eye can follow what a filter did. */}
          <AnimatePresence initial={false}>
            {groups.map((group) => {
              const dayTotal = sumMinor(
                group.txns
                  .filter((t) => !t.voided)
                  .flatMap((t) =>
                    t.postings
                      .filter((p) => accounts.get(p.accountId)?.class === 'expense_category')
                      .map((p) => p.baseAmount),
                  ),
              );
              return (
                <motion.section
                  key={group.date}
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.18 } }}
                >
                  <div className="sticky top-14 z-[1] flex items-baseline justify-between bg-paper/90 px-2 py-1.5 backdrop-blur-sm">
                    <h2 className="display text-[0.9375rem]">{formatRelativeDay(group.date, asOf)}</h2>
                    <span className="flex items-center gap-2 text-xs text-ink-4">
                      <span className="tnum">{formatDate(group.date, 'medium')}</span>
                      {dayTotal > 0 && <Money value={dayTotal} hidden={hidden} size="xs" tone="muted" symbol={false} />}
                    </span>
                  </div>
                  <ul className="divide-y divide-line">
                    <AnimatePresence initial={false}>
                      {group.txns.map((txn) => (
                        <motion.li
                          key={txn.id}
                          layout="position"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, transition: { duration: 0.14 } }}
                        >
                          <TransactionRow
                            txn={txn}
                            accounts={accounts}
                            hidden={hidden}
                            onClick={() => navigate(`/transactions/${txn.id}`)}
                            className={cn('rounded-[--radius] px-2', detailId === txn.id && 'bg-surface-2')}
                          />
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </motion.section>
              );
            })}
          </AnimatePresence>

          {list.hasMore && (
            <div ref={list.sentinelRef} className="flex flex-col items-center gap-2 py-2">
              <Button variant="secondary" size="sm" onClick={list.showMore}>
                Show more
              </Button>
              <p className="tnum text-xs text-ink-4">
                {list.count} of {filtered.length}
              </p>
            </div>
          )}
        </div>
      )}

      <TransactionDetail
        id={detailId}
        onClose={() => navigate('/transactions')}
        onEdit={onEdit}
      />
    </div>
  );
}

// ===========================================================================
// Detail
// ===========================================================================

export function TransactionDetail({
  id,
  onClose,
  onEdit }: {
  id: ID | null;
  onClose: () => void;
  onEdit: (id: ID) => void;
}) {
  const accounts = useAccountMap();
  const transactions = useStore((s) => s.transactions);
  const ops = useStore((s) => s.ops);
  const settings = useStore((s) => s.settings);
  const voidTransaction = useStore((s) => s.voidTransaction);
  const restoreTransaction = useStore((s) => s.restoreTransaction);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const txn = id ? transactions.find((t) => t.id === id) ?? null : null;
  const history = React.useMemo(() => (txn ? historyFor(ops, txn.id) : []), [ops, txn]);
  const linked = React.useMemo(
    () => (txn ? transactions.filter((t) => t.linkedTxnId === txn.id && !t.voided) : []),
    [transactions, txn],
  );
  const original = txn?.linkedTxnId ? transactions.find((t) => t.id === txn.linkedTxnId) : null;

  if (!txn) return null;

  const d = describeTransaction(txn, accounts);
  const refundTotal = sumMinor(
    linked.flatMap((r) =>
      r.postings
        .filter((p) => accounts.get(p.accountId)?.class === 'expense_category')
        .map((p) => -p.baseAmount),
    ),
  );

  return (
    <Sheet open onClose={onClose} title={d.title} description={formatDate(txn.date, 'long')} size="lg">
      <div className="space-y-5 pb-2">
        {txn.voided && (
          <Notice tone="neutral" title="This transaction is deleted">
            It is excluded from every total but kept so it can be restored.
          </Notice>
        )}

        <div className="text-center">
          <Money
            value={signedAmount(d)}
            hidden={settings.hideAmounts}
            size="display"
            weight="semibold"
            sign={d.direction === 'neutral' ? 'never' : 'always'}
            tone={d.direction === 'in' ? 'positive' : 'default'}
          />
          <div className="mt-2 flex justify-center gap-2">
            <Badge tone="neutral">{d.kindLabel}</Badge>
            {d.isSplit && <Badge tone="info">Split</Badge>}
            {d.isShared && <Badge tone="info">Shared</Badge>}
            {txn.recurrenceId && <Badge tone="accent">Recurring</Badge>}
            {txn.importBatchId && <Badge tone="neutral">Imported</Badge>}
          </div>
        </div>

        {/* The postings, shown plainly — the ledger has nothing to hide. */}
        <section>
          <h3 className="eyebrow mb-2.5">Where the money moved</h3>
          <Reckoning
            size="sm"
            currency={txn.currency}
            hidden={settings.hideAmounts}
            lines={txn.postings.map((p) => ({
              key: p.id,
              label: accounts.get(p.accountId)?.name ?? 'Unknown account',
              detail: p.memo ?? undefined,
              amount: p.amount }))}
            total={{ label: 'Balances to', amount: 0 }}
          />
          <p className="mt-2 text-xs text-ink-4">
            Every transaction balances to zero. Money is only ever moved, never created.
          </p>
        </section>

        {(original || linked.length > 0) && (
          <section>
            <h3 className="eyebrow mb-2.5">Linked</h3>
            <div className="space-y-1.5">
              {original && (
                <LinkedRow
                  label="Refund of"
                  txn={original}
                  onClick={() => navigate(`/transactions/${original.id}`)}
                />
              )}
              {linked.map((r) => (
                <LinkedRow
                  key={r.id}
                  label="Refunded"
                  txn={r}
                  onClick={() => navigate(`/transactions/${r.id}`)}
                />
              ))}
            </div>
            {refundTotal > 0 && (
              <p className="mt-2.5 text-xs text-ink-3">
                Net cost after refunds:{' '}
                <Money value={d.amount - refundTotal} size="xs" className="font-medium" />
              </p>
            )}
          </section>
        )}

        {(txn.notes || txn.tags.length > 0) && (
          <section className="space-y-2">
            {txn.notes && <p className="text-sm leading-relaxed text-ink-2">{txn.notes}</p>}
            {txn.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {txn.tags.map((t) => (
                  <Badge key={t} tone="accent">#{t}</Badge>
                ))}
              </div>
            )}
          </section>
        )}

        <AttachmentStrip attachmentIds={txn.attachmentIds} />

        <AuditTrail history={history} currency={txn.currency} />

        <div className="flex gap-2.5 border-t border-line pt-4">
          {txn.voided ? (
            <Button
              variant="primary"
              full
              icon={<RotateCcw className="size-4" />}
              onClick={() => {
                void restoreTransaction(txn.id);
                toast.saved('Transaction restored');
              }}
            >
              Restore
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                full
                icon={<Pencil className="size-4" />}
                onClick={() => {
                  onClose();
                  onEdit(txn.id);
                }}
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                icon={<Trash2 className="size-4" />}
                onClick={() => setConfirmDelete(true)}
                className="text-negative"
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this transaction?"
        tone="danger"
        confirmLabel="Delete"
        body={
          <>
            It will be removed from all balances and totals, but kept in your history so you can
            restore it later. Nothing is permanently erased.
          </>
        }
        onConfirm={async () => {
          await voidTransaction(txn.id);
          toast.saved('Transaction deleted', {
            label: 'Undo',
            run: () => void restoreTransaction(txn.id) });
          onClose();
        }}
      />
    </Sheet>
  );
}

function LinkedRow({
  label,
  txn,
  onClick }: {
  label: string;
  txn: Transaction;
  onClick: () => void;
}) {
  const accounts = useAccountMap();
  const d = describeTransaction(txn, accounts);
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[11px] border border-line px-3 py-2.5 text-left transition-colors hover:border-accent"
    >
      <Link2 className="size-4 shrink-0 text-ink-4" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.6875rem] uppercase tracking-wide text-ink-4">{label}</p>
        <p className="truncate text-[0.8125rem] font-medium text-ink">{d.title}</p>
      </div>
      <Money value={d.amount} size="sm" symbol={false} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Audit trail — §18
// ---------------------------------------------------------------------------

function AuditTrail({ history, currency }: { history: Op[]; currency: string }) {
  const [open, setOpen] = React.useState(false);
  if (history.length === 0) return null;

  const amended = history.filter((op) => op.type === 'txn.amended').length;

  return (
    <section>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-[10px] py-1.5 text-left"
      >
        <span className="eyebrow flex items-center gap-1.5">
          <History className="size-3" />
          History
          {amended > 0 && (
            <span className="ms-1 rounded-full bg-warn-soft px-1.5 py-px text-[0.625rem] font-medium normal-case tracking-normal text-warn">
              edited {amended}×
            </span>
          )}
        </span>
        <span className="text-xs text-accent">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <ol className="mt-2.5 space-y-3 border-s border-line ps-4 fade-in">
          {history.map((op) => (
            <li key={op.id} className="relative">
              <span
                className="absolute -start-[1.3125rem] top-1.5 size-2 rounded-full bg-line-strong ring-4 ring-[--surface]"
                aria-hidden="true"
              />
              <p className="text-[0.8125rem] text-ink">{op.summary}</p>
              <p className="tnum mt-0.5 text-[0.6875rem] text-ink-4">
                {new Date(op.createdAt).toLocaleString()}
              </p>

              {op.changes && op.changes.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {op.changes.map((change) => (
                    <li key={change.field} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                      <span className="text-ink-3">{change.label}:</span>
                      <ChangeValue value={change.before} money={change.money} currency={currency} strike />
                      <span className="text-ink-4" aria-label="changed to">→</span>
                      <ChangeValue value={change.after} money={change.money} currency={currency} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ChangeValue({
  value,
  money,
  currency,
  strike }: {
  value: unknown;
  money?: boolean;
  currency: string;
  strike?: boolean;
}) {
  const className = cn('font-medium', strike ? 'text-ink-4 line-through' : 'text-ink');

  if (money && typeof value === 'number') {
    return <Money value={value} currency={currency} size="xs" className={className} />;
  }
  if (value == null || value === '') return <span className={className}>empty</span>;
  if (Array.isArray(value)) return <span className={className}>{value.join(', ') || 'none'}</span>;
  if (typeof value === 'boolean') return <span className={className}>{value ? 'yes' : 'no'}</span>;
  return <span className={className}>{String(value)}</span>;
}

export { TXN_KIND_LABELS };
export type { TxnKind };
