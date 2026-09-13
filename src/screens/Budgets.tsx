import * as React from 'react';
import { Archive, CircleAlert, PieChart, Plus, Pencil, TriangleAlert } from 'lucide-react';
import { Button, EmptyState, ExpandingRow, Notice, Progress } from '../ui/primitives';
import { Money } from '../ui/Money';
import { Reckoning } from '../ui/Reckoning';
import { Sheet, Confirm } from '../ui/Sheet';
import { AmountInput, DateInput, Field, Select, TextInput } from '../ui/fields';
import { toast } from '../ui/toast';
import { cn } from '../ui/cn';
import { navigate } from '../app/router';
import { useBudgetStatuses, useCategories, useToday, useSpendableAccounts } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import type { BudgetStatus } from '../core/projections';
import type { Budget, BudgetPeriod, ID } from '../core/types';

export function Budgets() {
  const statuses = useBudgetStatuses();
  const budgets = useStore((s) => s.budgets);
  const settings = useStore((s) => s.settings);
  const [editing, setEditing] = React.useState<Budget | 'new' | null>(null);
  const [openId, setOpenId] = React.useState<ID | null>(null);
  const hidden = settings.hideAmounts;

  const archived = budgets.filter((b) => b.archived);
  const totalLimit = statuses.reduce((s, b) => s + b.limit, 0);
  const totalSpent = statuses.reduce((s, b) => s + b.spent, 0);

  // The ones that need a decision float to the top; the quiet ones can wait.
  const ordered = React.useMemo(() => {
    const rank: Record<BudgetStatus['health'], number> = { over: 0, projected_over: 1, warning: 2, on_track: 3 };
    return [...statuses].sort((a, b) => rank[a.health] - rank[b.health] || b.used - a.used);
  }, [statuses]);

  return (
    <div className="space-y-6">
      {statuses.length > 0 && (
        <section>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-ink-4 mb-3">Still available</p>
          <div className="count-in flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <Money
              value={totalLimit - totalSpent}
              currency={settings.baseCurrency}
              hidden={hidden}
              size="display"
              weight="semibold"
              tone={totalLimit - totalSpent < 0 ? 'negative' : 'default'}
            />
            <div className="flex gap-5 pb-1.5">
              <span className="flex flex-col gap-0.5">
                <span className="text-[0.625rem] font-semibold uppercase tracking-widest text-ink-4">Budgeted</span>
                <Money value={totalLimit} currency={settings.baseCurrency} hidden={hidden} size="sm" weight="semibold" symbol={false} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[0.625rem] font-semibold uppercase tracking-widest text-ink-4">Spent</span>
                <Money value={totalSpent} currency={settings.baseCurrency} hidden={hidden} size="sm" weight="semibold" symbol={false} />
              </span>
            </div>
          </div>
          <div className="reckoning-rule reckoning-rule--total mt-4" aria-hidden="true" />
        </section>
      )}

      <div className="flex items-center justify-between">
        <h2 className="display text-[1.0625rem]">Budgets</h2>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
          New budget
        </Button>
      </div>

      {statuses.length === 0 ? (
        <EmptyState
          icon={<PieChart className="size-5" />}
          title="No budgets yet"
          body="Set a limit per category. Pocketa shows how much is left and where you are heading."
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Create a budget
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-line rounded-[--radius-lg] border border-line bg-surface overflow-hidden">
          {ordered.map((status) => (
            <li key={status.budget.id}>
              <BudgetCard
                status={status}
                hidden={hidden}
                currency={settings.baseCurrency}
                open={openId === status.budget.id}
                onToggle={() => setOpenId((id) => (id === status.budget.id ? null : status.budget.id))}
                onEdit={() => setEditing(status.budget)}
              />
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <section>
          <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-widest text-ink-4">
            Archived · {archived.length}
          </p>
          <ul className="divide-y divide-line rounded-[--radius] border border-line bg-surface overflow-hidden">
            {archived.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[0.8125rem] text-ink-2">{b.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <BudgetEditor budget={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function BudgetCard({
  status,
  hidden,
  currency,
  open,
  onToggle,
  onEdit,
}: {
  status: BudgetStatus;
  hidden: boolean;
  currency: string;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const accounts = useStore((s) => s.accounts);
  const { budget } = status;

  const tone =
    status.health === 'over' ? 'negative' : status.health === 'on_track' ? 'accent' : 'warn';

  const names = budget.categoryIds
    .map((id) => accounts.find((a) => a.id === id)?.name)
    .filter(Boolean) as string[];
  const scope =
    budget.categoryIds.length === 0
      ? 'All spending'
      : names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');

  /**
   * Closed, the row answers "am I fine?": the bar against the period marker,
   * and what is left. Open, it answers "what do I do about it?".
   */
  return (
    <ExpandingRow
      open={open}
      onToggle={onToggle}
      tone={status.health === 'over' ? 'negative' : status.health === 'on_track' ? null : 'warn'}
      summary={
        <span className="block pe-2">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-semibold text-ink">{budget.name}</span>
            <span className="tnum shrink-0 text-xs text-ink-4">
              {status.daysRemaining} day{status.daysRemaining === 1 ? '' : 's'} left
            </span>
          </span>
          <Progress
            value={status.used}
            tone={tone}
            marker={status.daysTotal > 0 ? status.daysElapsed / status.daysTotal : undefined}
            markerLabel="Where the period is"
            label={`${budget.name} budget`}
            className="mt-2"
          />
        </span>
      }
      trailing={
        <span className="flex flex-col items-end">
          <Money
            value={Math.abs(status.remaining)}
            currency={currency}
            hidden={hidden}
            size="sm"
            weight="semibold"
            symbol={false}
            tone={status.remaining < 0 ? 'negative' : 'default'}
          />
          <span className="text-[0.6875rem] text-ink-4">{status.remaining < 0 ? 'over' : 'left'}</span>
        </span>
      }
    >
      <p className="mb-3 text-xs text-ink-3">
        {scope}
        {status.carry !== 0 && (
          <>
            {' · '}
            {status.carry > 0 ? 'includes ' : 'reduced by '}
            <Money value={Math.abs(status.carry)} currency={currency} hidden={hidden} size="xs" symbol={false} />
            {status.carry > 0 ? ' carried forward' : ' overspent last period'}
          </>
        )}
      </p>

      {status.projectionReliable ? (
        <Reckoning
          size="sm"
          currency={currency}
          hidden={hidden}
          showSigns={false}
          lines={[
            { key: 'spent', label: `Spent · ${Math.round(status.used * 100)}%`, amount: status.spent },
            { key: 'limit', label: 'Budget', amount: status.limit },
            { key: 'daily', label: 'Per remaining day', amount: status.safeDailyRemaining },
          ]}
          total={{ label: 'Heading for', amount: status.projected }}
        />
      ) : (
        <Reckoning
          size="sm"
          currency={currency}
          hidden={hidden}
          showSigns={false}
          lines={[
            { key: 'spent', label: `Spent · ${Math.round(status.used * 100)}%`, amount: status.spent },
            { key: 'limit', label: 'Budget', amount: status.limit },
          ]}
          total={{ label: 'Remaining', amount: status.remaining }}
        />
      )}

      {status.health === 'over' && (
        <Notice tone="negative" className="mt-3" icon={<CircleAlert className="size-4" />}>
          Over by <Money value={-status.remaining} currency={currency} hidden={hidden} size="sm" />.
        </Notice>
      )}
      {status.health === 'projected_over' && status.projectionReliable && (
        <Notice tone="warn" className="mt-3" icon={<TriangleAlert className="size-4" />}>
          Under <Money value={status.safeDailyRemaining} currency={currency} hidden={hidden} size="sm" symbol={false} /> a day keeps it inside.
        </Notice>
      )}

      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            navigate(
              budget.categoryIds.length === 1
                ? `/transactions?category=${budget.categoryIds[0]}`
                : '/transactions',
            )
          }
        >
          Transactions
        </Button>
        <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onEdit} aria-label={`Edit ${budget.name}`}>
          Edit
        </Button>
      </div>
    </ExpandingRow>
  );
}

// ===========================================================================

function BudgetEditor({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const saveBudget = useStore((s) => s.saveBudget);
  const archiveBudget = useStore((s) => s.archiveBudget);
  const settings = useStore((s) => s.settings);
  const tree = useCategories('expense_category');
  const spendableAccounts = useSpendableAccounts();
  const asOf = useToday();

  const isNew = !budget;
  const [name, setName] = React.useState(budget?.name ?? '');
  const [limit, setLimit] = React.useState<number | null>(budget?.limit ?? null);
  const [period, setPeriod] = React.useState<BudgetPeriod>(budget?.period ?? 'monthly');
  const [categoryIds, setCategoryIds] = React.useState<ID[]>(budget?.categoryIds ?? []);
  const [startDay, setStartDay] = React.useState(String(budget?.startDay ?? 1));
  const [customFrom, setCustomFrom] = React.useState(budget?.customFrom ?? asOf);
  const [customTo, setCustomTo] = React.useState(budget?.customTo ?? asOf);
  const [warnAt, setWarnAt] = React.useState(budget?.warnAt ?? 0.8);
  const [rolloverMode, setRolloverMode] = React.useState<'restart' | 'carry' | 'transfer'>(
    budget?.rolloverMode ?? (budget?.rollover ? 'carry' : 'restart'),
  );
  const [rolloverAccountId, setRolloverAccountId] = React.useState<ID | ''>(
    budget?.rolloverAccountId ?? '',
  );
  const [error, setError] = React.useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = React.useState(false);

  function toggleCategory(id: ID) {
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!name.trim()) return setError('Give the budget a name.');
    if (limit == null || limit <= 0) return setError('Set a limit greater than zero.');

    const row: Budget = {
      id: budget?.id ?? newId('bud'),
      name: name.trim(),
      categoryIds,
      limit,
      period,
      customFrom: period === 'custom' ? customFrom : null,
      customTo: period === 'custom' ? customTo : null,
      startDay: Number(startDay) || 1,
      rolloverMode,
      rolloverAccountId: rolloverMode === 'transfer' ? (rolloverAccountId || null) : null,
      rollover: rolloverMode === 'carry',
      warnAt,
      archived: false,
      color: budget?.color ?? null,
      createdAt: budget?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };

    await saveBudget(row, isNew);
    toast.saved(isNew ? 'Budget created' : 'Budget updated');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'New budget' : `Edit ${budget!.name}`}
      size="md"
      footer={
        <div className="flex gap-2.5">
          {!isNew && (
            <Button variant="secondary" icon={<Archive className="size-4" />} onClick={() => setConfirmArchive(true)}>
              Archive
            </Button>
          )}
          <Button variant="primary" full onClick={() => void save()}>
            {isNew ? 'Create budget' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Name" htmlFor="b-name">
          <TextInput
            id="b-name"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Groceries"
          />
        </Field>

        <Field label="Limit">
          <AmountInput value={limit} onChange={setLimit} currency={settings.baseCurrency} size="hero" />
        </Field>

        <Field label="Period">
          <Select value={period} onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="yearly">Yearly</option>
            <option value="custom">Custom dates</option>
          </Select>
        </Field>

        {period === 'monthly' && (
          <Field
            label="Month starts on day"
            hint="Set this to your payday if you budget from one salary to the next."
          >
            <Select value={startDay} onChange={(e) => setStartDay(e.target.value)}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {period === 'custom' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From">
              <DateInput value={customFrom} onChange={setCustomFrom} />
            </Field>
            <Field label="To">
              <DateInput value={customTo} onChange={setCustomTo} />
            </Field>
          </div>
        )}

        <Field
          label="Categories"
          hint={
            categoryIds.length === 0
              ? 'Nothing selected means this budget covers all spending.'
              : 'Selecting a parent category includes everything beneath it.'
          }
        >
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-[11px] border border-line p-2">
            {tree.map(({ parent, children }) => (
              <div key={parent.id}>
                <CategoryToggle
                  label={parent.name}
                  color={parent.color}
                  checked={categoryIds.includes(parent.id)}
                  onToggle={() => toggleCategory(parent.id)}
                />
                {children.map((child) => (
                  <CategoryToggle
                    key={child.id}
                    label={child.name}
                    color={child.color}
                    nested
                    checked={categoryIds.includes(child.id) || categoryIds.includes(parent.id)}
                    disabled={categoryIds.includes(parent.id)}
                    onToggle={() => toggleCategory(child.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </Field>

        <Field label="Warn me at">
          <Select value={String(warnAt)} onChange={(e) => setWarnAt(Number(e.target.value))}>
            <option value="0.5">50% of the limit</option>
            <option value="0.7">70% of the limit</option>
            <option value="0.8">80% of the limit</option>
            <option value="0.9">90% of the limit</option>
          </Select>
        </Field>

        <Field label="At month end">
          <Select value={rolloverMode} onChange={(e) => setRolloverMode(e.target.value as typeof rolloverMode)}>
            <option value="restart">Restart fresh</option>
            <option value="carry">Carry unspent forward</option>
            <option value="transfer">Move unspent to an account</option>
          </Select>
        </Field>

        {rolloverMode === 'transfer' && (
          <Field label="Transfer surplus into" hint="At the start of each new period, any leftover is transferred into this account automatically.">
            <Select value={rolloverAccountId} onChange={(e) => setRolloverAccountId(e.target.value as ID)}>
              <option value="">Choose an account</option>
              {spendableAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
        )}

        {error && <Notice tone="negative">{error}</Notice>}
      </div>

      <Confirm
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={`Archive ${budget?.name}?`}
        confirmLabel="Archive"
        body="The budget stops tracking, but your transactions are untouched."
        onConfirm={async () => {
          await archiveBudget(budget!.id, true);
          toast.saved('Budget archived');
          onClose();
        }}
      />
    </Sheet>
  );
}

function CategoryToggle({
  label,
  color,
  checked,
  onToggle,
  nested,
  disabled }: {
  label: string;
  color: string | null;
  checked: boolean;
  onToggle: () => void;
  nested?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-left text-[0.8125rem] transition-colors',
        nested && 'ps-7',
        checked ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2',
        disabled && 'cursor-default opacity-60',
      )}
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[5px] border',
          checked ? 'border-accent-fill bg-accent-fill text-[--accent-ink]' : 'border-line-strong',
        )}
        aria-hidden="true"
      >
        {checked && (
          <svg viewBox="0 0 24 24" className="size-3" fill="none">
            <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="size-2 shrink-0 rounded-full" style={{ background: color ?? 'var(--ink-4)' }} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}
