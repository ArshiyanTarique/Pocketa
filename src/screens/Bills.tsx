import * as React from 'react';
import {
  CalendarClock,
  Check,
  CircleSlash,
  Plus,
  RotateCcw,
  TriangleAlert,
  Repeat } from 'lucide-react';
import { Card, CardHeader, Badge, Button, EmptyState, ExpandingRow, Notice, SectionLabel, Segmented } from '../ui/primitives';
import { Money } from '../ui/Money';
import { Sheet, Confirm } from '../ui/Sheet';
import { AmountInput, DateInput, Field, Select, TextInput, Textarea, Toggle } from '../ui/fields';
import { toast } from '../ui/toast';
import { cn } from '../ui/cn';
import { useFlatCategories, useOccurrences, useSpendableAccounts, useToday } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { clampNote, describeRecurrence, occurrencesPerYear, type OccurrenceView } from '../core/recurrence';
import { formatDate, formatRelativeDay, nowIso } from '../core/dates';
import { newId } from '../core/ids';
import type { ID, Recurrence, RecurrenceFrequency } from '../core/types';
import type { TxnDraft } from '../core/draft';

type Tab = 'due' | 'all' | 'templates';

export function Bills() {
  const occurrences = useOccurrences(3);
  const recurrences = useStore((s) => s.recurrences);
  const settings = useStore((s) => s.settings);
  const asOf = useToday();
  const hidden = settings.hideAmounts;

  const [tab, setTab] = React.useState<Tab>('due');
  const [editing, setEditing] = React.useState<Recurrence | 'new' | null>(null);
  const [paying, setPaying] = React.useState<OccurrenceView | null>(null);

  const overdue = occurrences.filter((o) => o.status === 'overdue');
  const upcoming = occurrences.filter(
    (o) => (o.status === 'due' || o.status === 'upcoming') && o.daysUntilDue <= 45,
  );
  const settled = occurrences.filter((o) => o.status === 'paid' || o.status === 'skipped');

  const monthlyCost = recurrences
    .filter((r) => !r.archived && r.kind === 'expense')
    .reduce((sum, r) => sum + (r.amount * occurrencesPerYear(r)) / 12, 0);

  return (
    <div className="space-y-5">
      <section>
        <p className="label">Bills · a month</p>
        <div className="count-in mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <Money
            value={Math.round(monthlyCost)}
            currency={settings.baseCurrency}
            hidden={hidden}
            size="display"
            weight="semibold"
          />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} className="mb-1">
            Add a bill
          </Button>
        </div>
        <div className="reckoning-rule reckoning-rule--total mt-4" aria-hidden="true" />
      </section>

      {overdue.length > 0 && (
        <Notice
          tone="negative"
          icon={<TriangleAlert className="size-4" />}
          title={`${overdue.length} past due, not yet marked paid or skipped`}
        />
      )}

      <Segmented
        label="Filter bills"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'due', label: `Due (${overdue.length + upcoming.length})` },
          { value: 'all', label: 'Recently settled' },
          { value: 'templates', label: 'All bills' },
        ]}
      />

      {tab === 'due' && (
        <div className="space-y-4">
          {overdue.length === 0 && upcoming.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarClock className="size-5" />}
                title="Nothing due"
                body="Rent, utilities, subscriptions — add them and they are reserved."
                action={
                  <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                    Add a bill
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              {overdue.length > 0 && (
                <OccurrenceList
                  title="Overdue"
                  items={overdue}
                  hidden={hidden}
                  currency={settings.baseCurrency}
                  asOf={asOf}
                  onPay={setPaying}
                />
              )}
              {upcoming.length > 0 && (
                <OccurrenceList
                  title="Coming up"
                  items={upcoming}
                  hidden={hidden}
                  currency={settings.baseCurrency}
                  asOf={asOf}
                  onPay={setPaying}
                />
              )}
            </>
          )}
        </div>
      )}

      {tab === 'all' && (
        <OccurrenceList
          title="Settled"
          items={settled.slice(-30).reverse()}
          hidden={hidden}
          currency={settings.baseCurrency}
          asOf={asOf}
          onPay={setPaying}
          emptyMessage="Nothing has been marked paid or skipped yet."
        />
      )}

      {tab === 'templates' && (
        <Card>
          <CardHeader title="Every bill" eyebrow={`${recurrences.filter((r) => !r.archived).length} active`} />
          {recurrences.length === 0 ? (
            <EmptyState compact title="No bills set up" />
          ) : (
            <ul className="pb-2">
              {recurrences.map((rec) => (
                <li key={rec.id}>
                  <button
                    onClick={() => setEditing(rec)}
                    className={cn(
                      'flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2',
                      rec.archived && 'opacity-55',
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-surface-2 text-ink-3">
                      <Repeat className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{rec.name}</span>
                        {rec.archived && <Badge tone="neutral">Stopped</Badge>}
                        {rec.kind === 'income' && <Badge tone="positive">Income</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-3">{describeRecurrence(rec)}</p>
                    </div>
                    <Money value={rec.amount} currency={rec.currency} hidden={hidden} size="sm" weight="medium" symbol={false} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {editing && (
        <RecurrenceEditor
          recurrence={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {paying && <PayOccurrence occurrence={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function OccurrenceList({
  title,
  items,
  hidden,
  currency,
  asOf,
  onPay,
  emptyMessage }: {
  title: string;
  items: OccurrenceView[];
  hidden: boolean;
  currency: string;
  asOf: string;
  onPay: (o: OccurrenceView) => void;
  emptyMessage?: string;
}) {
  const [open, setOpen] = React.useState<string | null>(null);

  /**
   * A heading and a list of rows that open in place. Each row shows what you
   * scan for — name, when, how much, whether it is late — and keeps the
   * schedule and the action for when you have chosen one.
   */
  return (
    <section>
      <SectionLabel count={items.length}>{title}</SectionLabel>
      {items.length === 0 ? (
        <EmptyState compact title={emptyMessage ?? 'Nothing here'} />
      ) : (
        <ul className="mt-1 divide-y divide-line rounded-[--radius] border border-line bg-surface">
          {items.map((occurrence) => {
            const settled = occurrence.status === 'paid' || occurrence.status === 'skipped';
            const late = occurrence.status === 'overdue';
            return (
              <li key={occurrence.key}>
                <ExpandingRow
                  open={open === occurrence.key}
                  onToggle={() => setOpen((k) => (k === occurrence.key ? null : occurrence.key))}
                  tone={late ? 'negative' : occurrence.status === 'paid' ? 'positive' : null}
                  leading={
                    <span
                      className={cn(
                        'flex size-10 shrink-0 flex-col items-center justify-center rounded-[--radius]',
                        late ? 'bg-negative-soft text-negative' : occurrence.status === 'paid' ? 'bg-positive-soft text-positive' : 'bg-surface-2 text-ink',
                      )}
                    >
                      <span className="tnum text-[0.875rem] font-semibold leading-none">{occurrence.dueDate.slice(8, 10)}</span>
                      <span className="mt-0.5 text-[0.5625rem] font-semibold uppercase leading-none opacity-70">
                        {formatDate(occurrence.dueDate, 'short').split(' ')[1]}
                      </span>
                    </span>
                  }
                  summary={
                    <span className="block">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">{occurrence.recurrence.name}</span>
                        {occurrence.amountChanged && <Badge tone="info">changed</Badge>}
                        {occurrence.status === 'skipped' && <Badge tone="neutral">skipped</Badge>}
                      </span>
                      <span className={cn('block text-xs', late ? 'font-semibold text-negative' : 'text-ink-3')}>
                        {late ? `${Math.abs(occurrence.daysUntilDue)}d overdue` : formatRelativeDay(occurrence.dueDate, asOf)}
                      </span>
                    </span>
                  }
                  trailing={<Money value={occurrence.amount} currency={currency} hidden={hidden} size="sm" weight="semibold" symbol={false} />}
                >
                  <p className="text-xs text-ink-3">{describeRecurrence(occurrence.recurrence)}</p>
                  <div className="mt-3 flex gap-2">
                    {settled ? (
                      <Button size="sm" variant="secondary" onClick={() => onPay(occurrence)}>
                        Change
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => onPay(occurrence)}>
                        Record payment
                      </Button>
                    )}
                  </div>
                </ExpandingRow>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ===========================================================================
// Recording one occurrence
// ===========================================================================

function PayOccurrence({
  occurrence,
  onClose }: {
  occurrence: OccurrenceView;
  onClose: () => void;
}) {
  const createTransaction = useStore((s) => s.createTransaction);
  const setOccurrence = useStore((s) => s.setOccurrence);
  const clearOccurrence = useStore((s) => s.clearOccurrence);
  const asOf = useToday();

  const rec = occurrence.recurrence;
  const [amount, setAmount] = React.useState<number | null>(occurrence.amount);
  const [paidDate, setPaidDate] = React.useState(occurrence.dueDate > asOf ? asOf : occurrence.dueDate);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const differs = amount != null && amount !== rec.amount;

  async function markPaid() {
    if (amount == null || amount <= 0) return setError('Enter the amount that was actually paid.');
    setSaving(true);
    setError(null);

    const common = {
      date: paidDate,
      merchant: rec.merchant ?? rec.name,
      notes: rec.notes,
      tags: rec.tags,
      recurrenceId: rec.id,
      occurrenceKey: occurrence.key,
    };

    // A recurring transfer must post as a movement, not as spending — the whole
    // point of the ledger model is that a transfer touches no category.
    const draft: TxnDraft =
      rec.kind === 'transfer'
        ? {
            ...common,
            type: 'move',
            kind: 'transfer',
            fromAccountId: rec.accountId,
            toAccountId: rec.toAccountId!,
            amount,
          }
        : rec.kind === 'income'
          ? {
              ...common,
              type: 'earn',
              accountId: rec.accountId,
              allocations: [{ categoryId: rec.categoryId!, amount }],
            }
          : {
              ...common,
              type: 'spend',
              accountId: rec.accountId,
              allocations: [{ categoryId: rec.categoryId!, amount }],
            };

    const result = await createTransaction(draft);

    if (!result.ok) {
      setSaving(false);
      setError(result.issues[0]?.message ?? 'This could not be recorded.');
      return;
    }

    // The override records what happened on THIS date. The template keeps its
    // own amount for every other occurrence.
    await setOccurrence({
      id: occurrence.override?.id ?? newId('ovr'),
      recurrenceId: rec.id,
      dueDate: occurrence.dueDate,
      status: 'paid',
      amount: differs ? amount : null,
      paidDate,
      txnId: result.value.id,
      notes: null,
      createdAt: occurrence.override?.createdAt ?? nowIso(),
      updatedAt: nowIso() });

    setSaving(false);
    toast.saved(`${rec.name} recorded`);
    onClose();
  }

  async function skip() {
    await setOccurrence({
      id: occurrence.override?.id ?? newId('ovr'),
      recurrenceId: rec.id,
      dueDate: occurrence.dueDate,
      status: 'skipped',
      amount: null,
      paidDate: null,
      txnId: null,
      notes: null,
      createdAt: occurrence.override?.createdAt ?? nowIso(),
      updatedAt: nowIso() });
    toast.saved(`${rec.name} skipped for ${formatDate(occurrence.dueDate, 'short')}`);
    onClose();
  }

  async function reset() {
    await clearOccurrence(rec.id, occurrence.dueDate);
    toast.show('Back to scheduled');
    onClose();
  }

  const settled = occurrence.status === 'paid' || occurrence.status === 'skipped';

  return (
    <Sheet
      open
      onClose={onClose}
      title={rec.name}
      description={`Due ${formatDate(occurrence.dueDate, 'long')}`}
      footer={
        settled ? (
          <Button variant="secondary" full icon={<RotateCcw className="size-4" />} onClick={() => void reset()}>
            Reset to scheduled
          </Button>
        ) : (
          <div className="flex gap-2.5">
            <Button variant="secondary" icon={<CircleSlash className="size-4" />} onClick={() => void skip()}>
              Skip
            </Button>
            <Button variant="primary" full loading={saving} icon={<Check className="size-4" />} onClick={() => void markPaid()}>
              Mark paid
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4 pb-2">
        {settled ? (
          <Notice tone="neutral">
            This occurrence is marked {occurrence.status}. Resetting it puts the date back on your
            list without changing the transaction it created.
          </Notice>
        ) : (
          <>
            <Field
              label="Amount paid"
              hint={
                differs
                  ? `The usual amount is ${rec.amount / 100}. Changing it here applies to this occurrence only.`
                  : undefined
              }
            >
              <AmountInput value={amount} onChange={setAmount} currency={rec.currency} size="hero" autoFocus />
            </Field>

            {differs && (
              <Notice tone="info" title="Only this occurrence changes">
                The recurring bill keeps its usual amount of{' '}
                <Money value={rec.amount} currency={rec.currency} size="sm" />, so next time it will
                expect that again.
              </Notice>
            )}

            <Field label="Date paid">
              <DateInput value={paidDate} onChange={setPaidDate} />
            </Field>
          </>
        )}

        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// ===========================================================================
// Template editor
// ===========================================================================

function RecurrenceEditor({
  recurrence,
  onClose }: {
  recurrence: Recurrence | null;
  onClose: () => void;
}) {
  const saveRecurrence = useStore((s) => s.saveRecurrence);
  const archiveRecurrence = useStore((s) => s.archiveRecurrence);
  const settings = useStore((s) => s.settings);
  const accounts = useSpendableAccounts();
  const expenseCats = useFlatCategories('expense_category');
  const incomeCats = useFlatCategories('income_category');
  const asOf = useToday();

  const isNew = !recurrence;
  const [name, setName] = React.useState(recurrence?.name ?? '');
  const [kind, setKind] = React.useState<'expense' | 'income' | 'transfer'>(
    recurrence?.kind ?? 'expense',
  );
  const [toAccountId, setToAccountId] = React.useState<ID | ''>(recurrence?.toAccountId ?? '');
  const [amount, setAmount] = React.useState<number | null>(recurrence?.amount ?? null);
  const [accountId, setAccountId] = React.useState<ID | ''>(recurrence?.accountId ?? accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = React.useState<ID | ''>(recurrence?.categoryId ?? '');
  const [frequency, setFrequency] = React.useState<RecurrenceFrequency>(recurrence?.frequency ?? 'monthly');
  const [interval, setInterval] = React.useState(String(recurrence?.interval ?? 1));
  const [byMonthDay, setByMonthDay] = React.useState(String(recurrence?.byMonthDay ?? Number(asOf.slice(8, 10))));
  const [byWeekday, setByWeekday] = React.useState(String(recurrence?.byWeekday ?? 1));
  const [startDate, setStartDate] = React.useState(recurrence?.startDate ?? asOf);
  const [endDate, setEndDate] = React.useState(recurrence?.endDate ?? '');
  const [leadDays, setLeadDays] = React.useState(String(recurrence?.leadDays ?? 7));
  const [notes, setNotes] = React.useState(recurrence?.notes ?? '');
  const [autoPost, setAutoPost] = React.useState(recurrence?.autoPost ?? false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmStop, setConfirmStop] = React.useState(false);

  const categories = kind === 'income' ? incomeCats : expenseCats;

  const preview: Recurrence = {
    id: recurrence?.id ?? 'preview',
    name,
    kind,
    amount: amount ?? 0,
    currency: settings.baseCurrency,
    accountId: accountId || '',
    categoryId: categoryId || null,
    toAccountId: kind === 'transfer' ? toAccountId || null : null,
    merchant: null,
    notes: null,
    tags: [],
    frequency,
    interval: Number(interval) || 1,
    byWeekday: frequency === 'weekly' ? Number(byWeekday) : null,
    byMonthDay: frequency === 'monthly' ? Number(byMonthDay) : null,
    startDate,
    endDate: endDate || null,
    maxOccurrences: null,
    leadDays: Number(leadDays) || 7,
    autoPost,
    archived: false,
    isBill: true,
    createdAt: recurrence?.createdAt ?? nowIso(),
    updatedAt: nowIso() };

  async function save() {
    if (!name.trim()) return setError('Give the bill a name.');
    if (amount == null || amount <= 0) return setError('Set the usual amount.');
    if (!accountId) return setError('Choose the account it comes from.');
    if (kind === 'transfer') {
      if (!toAccountId) return setError('Choose the account it moves into.');
      if (toAccountId === accountId) return setError('A transfer needs two different accounts.');
    } else if (!categoryId) {
      return setError('Choose a category.');
    }

    await saveRecurrence({ ...preview, id: recurrence?.id ?? newId('rec'), name: name.trim(), notes: notes.trim() || null }, isNew);
    toast.saved(isNew ? 'Bill added' : 'Bill updated');
    onClose();
  }

  const note = clampNote(preview);

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'Add a recurring bill' : `Edit ${recurrence!.name}`}
      size="md"
      footer={
        <div className="flex gap-2.5">
          {!isNew && (
            <Button variant="secondary" onClick={() => setConfirmStop(true)}>
              {recurrence!.archived ? 'Resume' : 'Stop'}
            </Button>
          )}
          <Button variant="primary" full onClick={() => void save()}>
            {isNew ? 'Add bill' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Segmented
          label="What kind of bill"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setCategoryId('');
          }}
          options={[
            { value: 'expense', label: 'Money out' },
            { value: 'income', label: 'Money in' },
            { value: 'transfer', label: 'Transfer' },
          ]}
        />

        <Field label="Name" htmlFor="r-name">
          <TextInput
            id="r-name"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'income' ? 'Salary' : 'Electricity'}
          />
        </Field>

        <Field label="Usual amount" hint="Individual months can differ without changing this.">
          <AmountInput value={amount} onChange={setAmount} currency={settings.baseCurrency} size="hero" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === 'income' ? 'Paid into' : 'Paid from'}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value as ID)}>
              <option value="">Choose an account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          {kind === 'transfer' ? (
            <Field label="Into">
              <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value as ID)}>
                <option value="">Choose an account</option>
                {accounts.filter((a) => a.id !== accountId).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value as ID)}>
                <option value="">Choose a category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.path}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Repeats">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="yearly">Yearly</option>
              <option value="daily">Daily</option>
              <option value="custom_days">Every N days</option>
            </Select>
          </Field>
          <Field label="Every">
            <Select value={interval} onChange={(e) => setInterval(e.target.value)}>
              {[1, 2, 3, 4, 6, 12].map((n) => (
                <option key={n} value={n}>
                  {n} {frequency === 'monthly' ? 'month' : frequency === 'weekly' ? 'week' : frequency === 'yearly' ? 'year' : 'day'}
                  {n > 1 ? 's' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {frequency === 'monthly' && (
          <Field label="On day of month">
            <Select value={byMonthDay} onChange={(e) => setByMonthDay(e.target.value)}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </Field>
        )}

        {frequency === 'weekly' && (
          <Field label="On">
            <Select value={byWeekday} onChange={(e) => setByWeekday(e.target.value)}>
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                <option key={d} value={i}>{d}</option>
              ))}
            </Select>
          </Field>
        )}

        {note && <Notice tone="info">{note}</Notice>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starting">
            <DateInput value={startDate} onChange={setStartDate} />
          </Field>
          <Field label="Ending" optional>
            <DateInput value={endDate} onChange={setEndDate} min={startDate} />
          </Field>
        </div>

        <Field label="Remind me this many days ahead">
          <Select value={leadDays} onChange={(e) => setLeadDays(e.target.value)}>
            {[1, 3, 5, 7, 14, 30].map((d) => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </Select>
        </Field>

        <Toggle
          checked={autoPost}
          onChange={setAutoPost}
          label="Record this automatically"
          description="On its due date Pocketa writes the transaction for you and tells you it did. Leave off to confirm each one yourself."
        />

        <Field label="Notes" optional>
          <Textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="rounded-[--radius] border border-line bg-surface-2/50 px-4 py-3">
          <p className="eyebrow mb-1">Schedule</p>
          <p className="text-[0.8125rem] text-ink">{describeRecurrence(preview)}</p>
        </div>

        {error && <Notice tone="negative">{error}</Notice>}
      </div>

      <Confirm
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title={recurrence?.archived ? `Resume ${recurrence.name}?` : `Stop ${recurrence?.name}?`}
        confirmLabel={recurrence?.archived ? 'Resume' : 'Stop'}
        body={
          recurrence?.archived
            ? 'Future occurrences will start appearing again.'
            : 'No future occurrences will be scheduled. Transactions already recorded are kept.'
        }
        onConfirm={async () => {
          await archiveRecurrence(recurrence!.id, !recurrence!.archived);
          onClose();
        }}
      />
    </Sheet>
  );
}
