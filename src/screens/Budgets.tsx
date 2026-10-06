import * as React from 'react';
import { Archive, ChevronDown, CircleAlert, PieChart, Plus, Pencil, TriangleAlert } from 'lucide-react';
import { Button, EmptyState, ExpandingRow, Notice, Progress } from '../ui/primitives';
import { Money } from '../ui/Money';
import { Reckoning } from '../ui/Reckoning';
import { Sheet, Confirm } from '../ui/Sheet';
import { AmountInput, DateInput, Field, Select, TextInput } from '../ui/fields';
import { toast } from '../ui/toast';
import { cn } from '../ui/cn';
import { navigate } from '../app/router';
import { useBudgetStatuses, useCategories, useToday, useSpendableAccounts, type CategoryTree } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import type { BudgetStatus } from '../core/projections';
import type { Budget, BudgetPeriod, ID } from '../core/types';

import { tr, trf } from '../app/i18n';
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
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-ink-4 mb-3">{tr('Still available')}</p>
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
                <span className="text-[0.625rem] font-semibold uppercase tracking-widest text-ink-4">{tr('Budgeted')}</span>
                <Money value={totalLimit} currency={settings.baseCurrency} hidden={hidden} size="sm" weight="semibold" symbol={false} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[0.625rem] font-semibold uppercase tracking-widest text-ink-4">{tr('Spent')}</span>
                <Money value={totalSpent} currency={settings.baseCurrency} hidden={hidden} size="sm" weight="semibold" symbol={false} />
              </span>
            </div>
          </div>
          <div className="reckoning-rule reckoning-rule--total mt-4" aria-hidden="true" />
        </section>
      )}

      <div className="flex items-center justify-between">
        <h2 className="display text-[1.0625rem]">{tr('Budgets')}</h2>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{tr('Add a budget')}</Button>
      </div>

      {statuses.length === 0 ? (
        <EmptyState
          icon={<PieChart className="size-5" />}
          title={tr('No budgets yet')}
          body={tr('Set a limit per category. Pocketa shows how much is left and where you are heading.')}
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{tr('Create a budget')}</Button>
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
            {tr('Archived')} · {archived.length}
          </p>
          <ul className="divide-y divide-line rounded-[--radius] border border-line bg-surface overflow-hidden">
            {archived.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[0.8125rem] text-ink-2">{b.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>{tr('Restore')}</Button>
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
      ? tr('All spending')
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
              {status.daysRemaining === 1 ? tr('1 day left') : trf('{n} days left', { n: status.daysRemaining })}
            </span>
          </span>
          <Progress
            value={status.used}
            tone={tone}
            marker={status.daysTotal > 0 ? status.daysElapsed / status.daysTotal : undefined}
            markerLabel={tr('Where the period is')}
            label={`${budget.name} ${tr('budget')}`}
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
          <span className="text-[0.6875rem] text-ink-4">{status.remaining < 0 ? tr('over') : tr('left')}</span>
        </span>
      }
    >
      <p className="mb-3 text-xs text-ink-3">
        {scope}
        {status.carry !== 0 && (
          <>
            {' · '}
            {status.carry > 0 ? tr('Carried in') : tr('Overspent last time')}{' '}
            <Money value={Math.abs(status.carry)} currency={currency} hidden={hidden} size="xs" symbol={false} />
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
            { key: 'spent', label: `${tr('Spent')} · ${Math.round(status.used * 100)}%`, amount: status.spent },
            { key: 'limit', label: tr('Budget'), amount: status.limit },
            { key: 'daily', label: tr('Per remaining day'), amount: status.safeDailyRemaining },
          ]}
          total={{ label: tr('Heading for'), amount: status.projected }}
        />
      ) : (
        <Reckoning
          size="sm"
          currency={currency}
          hidden={hidden}
          showSigns={false}
          lines={[
            { key: 'spent', label: `${tr('Spent')} · ${Math.round(status.used * 100)}%`, amount: status.spent },
            { key: 'limit', label: tr('Budget'), amount: status.limit },
          ]}
          total={{ label: tr('Remaining'), amount: status.remaining }}
        />
      )}

      {status.health === 'over' && (
        <Notice tone="negative" className="mt-3" icon={<CircleAlert className="size-4" />}>
          {tr('Over by')} <Money value={-status.remaining} currency={currency} hidden={hidden} size="sm" />.
        </Notice>
      )}
      {status.health === 'projected_over' && status.projectionReliable && (
        <Notice tone="warn" className="mt-3" icon={<TriangleAlert className="size-4" />}>
          {tr('Keep under')} <Money value={status.safeDailyRemaining} currency={currency} hidden={hidden} size="sm" symbol={false} /> {tr('a day to stay inside.')}
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
        >{tr('Transactions')}</Button>
        <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onEdit} aria-label={trf('Edit {name}', { name: budget.name })}>{tr('Edit')}</Button>
      </div>
    </ExpandingRow>
  );
}

// ===========================================================================

/**
 * A budget is a number and a thing it is for. That is the whole form.
 *
 * The period, the payday, exact sub-categories, the warning point and what
 * happens at month end all have defaults that suit nearly everyone, so they
 * wait under one "More options" button rather than standing between a person
 * and the Create button.
 */
function BudgetEditor({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const saveBudget = useStore((s) => s.saveBudget);
  const archiveBudget = useStore((s) => s.archiveBudget);
  const settings = useStore((s) => s.settings);
  const tree = useCategories('expense_category');
  const spendableAccounts = useSpendableAccounts();
  const asOf = useToday();

  const isNew = !budget;
  const [limit, setLimit] = React.useState<number | null>(budget?.limit ?? null);
  const [categoryIds, setCategoryIds] = React.useState<ID[]>(budget?.categoryIds ?? []);
  // "Everything" is a choice in its own right, not the absence of one.
  const [everything, setEverything] = React.useState(budget ? budget.categoryIds.length === 0 : false);
  const [name, setName] = React.useState(budget?.name ?? '');
  // The name follows the choice until someone types one of their own.
  const [nameTouched, setNameTouched] = React.useState(!!budget);
  const [showMore, setShowMore] = React.useState(false);
  const [period, setPeriod] = React.useState<BudgetPeriod>(budget?.period ?? 'monthly');
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

  const suggestedName = everything ? tr('Everything') : nameFor(categoryIds, tree);
  const shownName = nameTouched ? name : suggestedName;

  function chooseEverything() {
    setEverything(true);
    setCategoryIds([]);
    setError(null);
  }

  /** A whole category, children included: on if any part of it is chosen. */
  function toggleParent({ parent, children }: CategoryTree) {
    setEverything(false);
    setError(null);
    const family = [parent.id, ...children.map((c) => c.id)];
    setCategoryIds((prev) =>
      prev.some((id) => family.includes(id)) ? prev.filter((id) => !family.includes(id)) : [...prev, parent.id],
    );
  }

  function toggleCategory(id: ID) {
    setEverything(false);
    setError(null);
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (limit == null || limit <= 0) return setError(tr('Enter an amount.'));
    if (!everything && categoryIds.length === 0) return setError(tr('Pick what this budget is for.'));
    const finalName = (shownName.trim() || suggestedName).trim();

    const row: Budget = {
      id: budget?.id ?? newId('bud'),
      name: finalName,
      categoryIds: everything ? [] : categoryIds,
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
      // An envelope opened today holds nothing from before today.
      startsOn: budget?.startsOn ?? (isNew ? asOf : null),
      createdAt: budget?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };

    await saveBudget(row, isNew);
    toast.saved(isNew ? tr('Budget created') : tr('Budget updated'));
    onClose();
  }

  const amountLabel =
    period === 'monthly' ? tr('How much a month?')
    : period === 'weekly' ? tr('How much a week?')
    : period === 'yearly' ? tr('How much a year?')
    : tr('How much?');

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? tr('New budget') : trf('Edit {name}', { name: budget!.name })}
      size="md"
      footer={
        <div className="flex gap-2.5">
          {!isNew && (
            <Button variant="secondary" icon={<Archive className="size-4" />} onClick={() => setConfirmArchive(true)}>{tr('Archive')}</Button>
          )}
          <Button variant="primary" full onClick={() => void save()}>
            {isNew ? tr('Create budget') : tr('Save changes')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pb-2">
        <Field label={amountLabel} htmlFor="b-limit">
          <AmountInput id="b-limit" value={limit} onChange={setLimit} currency={settings.baseCurrency} size="hero" />
        </Field>

        <Field label={tr('What is it for?')}>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <ChoiceChip label={tr('Everything')} color={null} active={everything} onClick={chooseEverything} />
            {tree.map((node) => (
              <ChoiceChip
                key={node.parent.id}
                label={node.parent.name}
                color={node.parent.color}
                active={!everything && [node.parent, ...node.children].some((c) => categoryIds.includes(c.id))}
                onClick={() => toggleParent(node)}
              />
            ))}
          </div>
        </Field>

        {error && <Notice tone="negative">{error}</Notice>}

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="flex w-full items-center justify-between rounded-[--radius] border border-line px-3 py-2.5 text-[0.8125rem] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <span className="whitespace-nowrap">{tr('More options')}</span>
          <span className="flex items-center gap-2 text-xs font-normal text-ink-4">
            {!showMore && <span className="hidden sm:inline">{tr('Name, period, exact categories, month end')}</span>}
            <ChevronDown className={cn('size-4 shrink-0 transition-transform', showMore && 'rotate-180')} />
          </span>
        </button>

        {showMore && (
          <div className="space-y-4 rounded-[--radius] border border-line bg-surface-2/50 p-4 fade-in">
            <Field label={tr('Name')} htmlFor="b-name">
              <TextInput
                id="b-name"
                value={shownName}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
                placeholder={suggestedName || tr('Groceries')}
              />
            </Field>

            <Field label={tr('Period')}>
              <Select value={period} onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}>
                <option value="monthly">{tr('Monthly')}</option>
                <option value="weekly">{tr('Weekly')}</option>
                <option value="yearly">{tr('Yearly')}</option>
                <option value="custom">{tr('Custom dates')}</option>
              </Select>
            </Field>

            {period === 'monthly' && (
              <Field label={tr('Month starts on day (e.g. your payday)')}>
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
                <Field label={tr('From')}>
                  <DateInput value={customFrom} onChange={setCustomFrom} />
                </Field>
                <Field label={tr('To')}>
                  <DateInput value={customTo} onChange={setCustomTo} />
                </Field>
              </div>
            )}

            <Field label={tr('Exact categories')}>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-[11px] border border-line bg-surface p-2">
                {tree.map(({ parent, children }) => (
                  <div key={parent.id}>
                    <CategoryToggle
                      label={parent.name}
                      color={parent.color}
                      checked={!everything && categoryIds.includes(parent.id)}
                      onToggle={() => toggleCategory(parent.id)}
                    />
                    {children.map((child) => (
                      <CategoryToggle
                        key={child.id}
                        label={child.name}
                        color={child.color}
                        nested
                        checked={!everything && (categoryIds.includes(child.id) || categoryIds.includes(parent.id))}
                        disabled={!everything && categoryIds.includes(parent.id)}
                        onToggle={() => toggleCategory(child.id)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </Field>

            <Field label={tr('Warn me at')}>
              <Select value={String(warnAt)} onChange={(e) => setWarnAt(Number(e.target.value))}>
                {[0.5, 0.7, 0.8, 0.9].map((v) => (
                  <option key={v} value={v}>{Math.round(v * 100)}%</option>
                ))}
              </Select>
            </Field>

            <Field label={tr('At month end')}>
              <Select value={rolloverMode} onChange={(e) => setRolloverMode(e.target.value as typeof rolloverMode)}>
                <option value="restart">{tr('Restart fresh')}</option>
                <option value="carry">{tr('Carry unspent forward')}</option>
                <option value="transfer">{tr('Move unspent to an account')}</option>
              </Select>
            </Field>

            {rolloverMode === 'transfer' && (
              <Field label={tr('Move leftover into')}>
                <Select value={rolloverAccountId} onChange={(e) => setRolloverAccountId(e.target.value as ID)}>
                  <option value="">{tr('Choose an account')}</option>
                  {spendableAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
      </div>

      <Confirm
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={trf('Archive {name}?', { name: budget?.name ?? '' })}
        confirmLabel={tr('Archive')}
        body={tr('The budget stops tracking, but your transactions are untouched.')}
        onConfirm={async () => {
          await archiveBudget(budget!.id, true);
          toast.saved(tr('Budget archived'));
          onClose();
        }}
      />
    </Sheet>
  );
}

/** "Groceries", "Groceries, Fuel", or "Groceries +2" — whatever is chosen, named. */
function nameFor(categoryIds: ID[], tree: CategoryTree[]): string {
  const names: string[] = [];
  for (const { parent, children } of tree) {
    if (categoryIds.includes(parent.id)) names.push(parent.name);
    else for (const child of children) if (categoryIds.includes(child.id)) names.push(child.name);
  }
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} +${names.length - 1}`;
}

function ChoiceChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-[11px] border px-3 py-2 text-left text-[0.8125rem] font-medium transition-all',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: color ?? 'var(--ink-4)' }}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </button>
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
          checked ? 'border-accent-fill bg-accent-fill text-(--accent-ink)' : 'border-line-strong',
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
