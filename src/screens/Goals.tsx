import * as React from 'react';
import { Archive, ArrowDownToLine, ArrowUpFromLine, Flag, Plus, Target, Trophy } from 'lucide-react';
import { Badge, Button, EmptyState, ExpandingRow, Notice, Progress } from '../ui/primitives';
import { Money } from '../ui/Money';
import { Reckoning } from '../ui/Reckoning';
import { Sheet, Confirm } from '../ui/Sheet';
import { AmountInput, DateInput, Field, Select, TextInput, Textarea } from '../ui/fields';
import { toast } from '../ui/toast';
import { useBalances, useSpendableAccounts, useToday } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { balanceOf } from '../core/projections';
import { addDays, daysBetween, formatDate, nowIso } from '../core/dates';
import { newId } from '../core/ids';
import type { Account, Goal, ID } from '../core/types';

export function Goals() {
  const goals = useStore((s) => s.goals);
  const settings = useStore((s) => s.settings);
  const balances = useBalances();
  const asOf = useToday();
  const hidden = settings.hideAmounts;

  const [editing, setEditing] = React.useState<Goal | 'new' | null>(null);
  const [moving, setMoving] = React.useState<{ goal: Goal; direction: 'in' | 'out' } | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const active = goals.filter((g) => !g.archived);
  const done = active.filter((g) => balanceOf(balances, g.accountId) >= g.targetAmount);
  const totalSaved = active.reduce((sum, g) => sum + balanceOf(balances, g.accountId), 0);
  const totalTarget = active.reduce((sum, g) => sum + g.targetAmount, 0);

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <section>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-ink-4 mb-3">Set aside</p>
          <div className="count-in flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <Money
              value={totalSaved}
              currency={settings.baseCurrency}
              hidden={hidden}
              size="display"
              weight="semibold"
            />
            <div className="flex gap-5 pb-1.5">
              <span className="flex flex-col gap-0.5">
                <span className="text-[0.625rem] font-semibold uppercase tracking-widest text-ink-4">Target</span>
                <Money value={totalTarget} currency={settings.baseCurrency} hidden={hidden} size="sm" weight="semibold" symbol={false} />
              </span>
              {done.length > 0 && (
                <span className="flex flex-col gap-0.5">
                  <span className="text-[0.625rem] font-semibold uppercase tracking-widest text-ink-4">Reached</span>
                  <span className="tnum text-[0.8125rem] font-semibold text-positive">{done.length}</span>
                </span>
              )}
            </div>
          </div>
          <Progress value={totalTarget > 0 ? totalSaved / totalTarget : 0} tone="accent" label="Overall goal progress" className="mt-4" />
          <div className="reckoning-rule reckoning-rule--total mt-4" aria-hidden="true" />
        </section>
      )}

      <div className="flex items-center justify-between">
        <h2 className="display text-[1.0625rem]">Goals</h2>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
          New goal
        </Button>
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon={<Target className="size-5" />}
          title="No goals yet"
          body="Money set aside, without pretending you spent it."
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Create a goal
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-line rounded-[--radius-lg] border border-line bg-surface overflow-hidden">
          {active.map((goal) => (
            <li key={goal.id}>
              <GoalCard
                goal={goal}
                saved={balanceOf(balances, goal.accountId)}
                hidden={hidden}
                asOf={asOf}
                open={openId === goal.id}
                onToggle={() => setOpenId((id) => (id === goal.id ? null : goal.id))}
                onEdit={() => setEditing(goal)}
                onMove={(direction) => setMoving({ goal, direction })}
              />
            </li>
          ))}
        </ul>
      )}

      {editing && <GoalEditor goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {moving && (
        <MoveMoney
          goal={moving.goal}
          direction={moving.direction}
          saved={balanceOf(balances, moving.goal.accountId)}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function GoalCard({
  goal,
  saved,
  hidden,
  asOf,
  open,
  onToggle,
  onEdit,
  onMove,
}: {
  goal: Goal;
  saved: number;
  hidden: boolean;
  asOf: string;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onMove: (d: 'in' | 'out') => void;
}) {
  const remaining = Math.max(0, goal.targetAmount - saved);
  const reached = saved >= goal.targetAmount;
  const progress = goal.targetAmount > 0 ? saved / goal.targetAmount : 0;

  const plan = React.useMemo(() => {
    if (reached || !goal.targetDate) return null;
    const days = daysBetween(asOf, goal.targetDate);
    if (days <= 0) return { overdue: true, perMonth: remaining, perWeek: remaining, months: 0 };
    const months = Math.max(1, days / 30.44);
    return {
      overdue: false,
      perMonth: Math.ceil(remaining / months),
      perWeek: Math.ceil(remaining / Math.max(1, days / 7)),
      months,
    };
  }, [goal.targetDate, remaining, reached, asOf]);

  /**
   * The row is the goal at a glance: name, how far, how much. Open it for the
   * plan and the actions. A grid of cards said all of this for every goal at
   * once, which for five goals was a wall.
   */
  return (
    <ExpandingRow
      open={open}
      onToggle={onToggle}
      tone={reached ? 'positive' : plan?.overdue ? 'warn' : null}
      summary={
        <span className="block pr-2">
          <span className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 truncate">
              <span className="truncate text-sm font-semibold text-ink">{goal.name}</span>
              {reached && <Badge tone="positive" icon={<Trophy className="size-3" />}>Reached</Badge>}
            </span>
            <span className="tnum shrink-0 text-xs text-ink-3">
              {goal.targetDate ? `by ${formatDate(goal.targetDate)}` : 'no date'}
            </span>
          </span>
          <Progress value={progress} tone={reached ? 'positive' : 'accent'} label={`${goal.name} progress`} className="mt-2" />
        </span>
      }
      trailing={
        <span className="flex flex-col items-end">
          <Money value={saved} currency={goal.currency} hidden={hidden} size="sm" weight="semibold" symbol={false} />
          <span className="text-[0.6875rem] text-ink-4">
            of <Money value={goal.targetAmount} currency={goal.currency} hidden={hidden} size="xs" symbol={false} />
          </span>
        </span>
      }
    >
      {plan && !plan.overdue && (
        <Reckoning
          size="sm"
          currency={goal.currency}
          hidden={hidden}
          showSigns={false}
          lines={[
            { key: 'week', label: 'Each week', amount: plan.perWeek },
            { key: 'month', label: 'Each month', amount: plan.perMonth },
          ]}
          total={{ label: `Still needed · ${Math.round(plan.months)} months`, amount: remaining }}
        />
      )}
      {plan?.overdue && (
        <Notice tone="warn">
          Target date passed with <Money value={remaining} currency={goal.currency} hidden={hidden} size="sm" /> to go.
        </Notice>
      )}
      {reached && <p className="text-sm text-ink-2">Fully funded. Withdraw it whenever you need it.</p>}

      <div className="mt-4 flex gap-2">
        <Button size="sm" variant="primary" icon={<ArrowDownToLine className="size-3.5" />} onClick={() => onMove('in')}>
          Add money
        </Button>
        <Button size="sm" variant="secondary" icon={<ArrowUpFromLine className="size-3.5" />} onClick={() => onMove('out')} disabled={saved <= 0}>
          Take out
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${goal.name}`}>
          Edit
        </Button>
      </div>
    </ExpandingRow>
  );
}

// ===========================================================================

function GoalEditor({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const saveGoal = useStore((s) => s.saveGoal);
  const saveAccount = useStore((s) => s.saveAccount);
  const archiveGoal = useStore((s) => s.archiveGoal);
  const settings = useStore((s) => s.settings);
  const asOf = useToday();

  const isNew = !goal;
  const [name, setName] = React.useState(goal?.name ?? '');
  const [target, setTarget] = React.useState<number | null>(goal?.targetAmount ?? null);
  const [targetDate, setTargetDate] = React.useState(goal?.targetDate ?? '');
  const [planned, setPlanned] = React.useState<number | null>(goal?.plannedContribution ?? null);
  const [notes, setNotes] = React.useState(goal?.notes ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = React.useState(false);

  async function save() {
    if (!name.trim()) return setError('Give the goal a name.');
    if (target == null || target <= 0) return setError('Set a target greater than zero.');

    let accountId = goal?.accountId;

    // Each goal is backed by a real account, so contributions are transfers the
    // ledger can verify rather than a number stored on the goal itself.
    if (!accountId) {
      const account: Account = {
        id: newId('acc'),
        class: 'goal',
        name: name.trim(),
        parentId: null,
        currency: settings.baseCurrency,
        icon: 'target',
        color: '#145C55',
        archived: false,
        archivedAt: null,
        system: false,
        sortOrder: 0,
        notes: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await saveAccount(account, true);
      accountId = account.id;
    }

    const row: Goal = {
      id: goal?.id ?? newId('gol'),
      name: name.trim(),
      targetAmount: target,
      targetDate: targetDate || null,
      accountId,
      currency: settings.baseCurrency,
      icon: null,
      color: null,
      notes: notes.trim() || null,
      plannedContribution: planned,
      plannedFrequency: planned ? 'monthly' : null,
      archived: false,
      completedAt: goal?.completedAt ?? null,
      createdAt: goal?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };

    await saveGoal(row, isNew);
    toast.saved(isNew ? 'Goal created' : 'Goal updated');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'New goal' : `Edit ${goal!.name}`}
      footer={
        <div className="flex gap-2.5">
          {!isNew && (
            <Button variant="secondary" icon={<Archive className="size-4" />} onClick={() => setConfirmArchive(true)}>
              Archive
            </Button>
          )}
          <Button variant="primary" full onClick={() => void save()}>
            {isNew ? 'Create goal' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="What are you saving for?" htmlFor="g-name">
          <TextInput
            id="g-name"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Laptop"
          />
        </Field>

        <Field label="Target amount">
          <AmountInput value={target} onChange={setTarget} currency={settings.baseCurrency} size="hero" />
        </Field>

        <Field label="Target date" optional hint="Pocketa works out what you would need to put aside.">
          <DateInput value={targetDate} onChange={setTargetDate} min={asOf} />
        </Field>

        <Field
          label="Planned monthly contribution"
          optional
          hint="Reserved from your safe-to-spend until you have made it each month."
        >
          <AmountInput value={planned} onChange={setPlanned} currency={settings.baseCurrency} />
        </Field>

        <Field label="Notes" optional>
          <Textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <Notice tone="negative">{error}</Notice>}
      </div>

      <Confirm
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={`Archive ${goal?.name}?`}
        confirmLabel="Archive"
        body="The goal stops appearing, but the money stays where it is and every contribution is kept."
        onConfirm={async () => {
          await archiveGoal(goal!.id, true);
          toast.saved('Goal archived');
          onClose();
        }}
      />
    </Sheet>
  );
}

// ===========================================================================

function MoveMoney({
  goal,
  direction,
  saved,
  onClose,
}: {
  goal: Goal;
  direction: 'in' | 'out';
  saved: number;
  onClose: () => void;
}) {
  const createTransaction = useStore((s) => s.createTransaction);
  const accounts = useSpendableAccounts();
  const asOf = useToday();

  const [amount, setAmount] = React.useState<number | null>(
    direction === 'in' ? goal.plannedContribution : null,
  );
  const [accountId, setAccountId] = React.useState<ID | ''>(accounts[0]?.id ?? '');
  const [date, setDate] = React.useState(asOf);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    if (!accountId) return setError('Choose an account.');
    if (amount == null || amount <= 0) return setError('Enter an amount greater than zero.');
    if (direction === 'out' && amount > saved) {
      return setError('You cannot take out more than the goal holds.');
    }

    setSaving(true);
    const result = await createTransaction({
      type: 'move',
      kind: direction === 'in' ? 'goal_contribution' : 'goal_withdrawal',
      date,
      fromAccountId: direction === 'in' ? accountId : goal.accountId,
      toAccountId: direction === 'in' ? goal.accountId : accountId,
      amount,
      merchant: goal.name,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.issues[0]?.message ?? 'This could not be recorded.');
      return;
    }
    toast.saved(direction === 'in' ? `Added to ${goal.name}` : `Taken from ${goal.name}`);
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={direction === 'in' ? `Add to ${goal.name}` : `Take from ${goal.name}`}
      description="Moving money to a goal is a transfer, not spending — your expenses for the month are unaffected."
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" full loading={saving} onClick={() => void submit()}>
            {direction === 'in' ? 'Add money' : 'Take money out'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Amount">
          <AmountInput value={amount} onChange={setAmount} currency={goal.currency} size="hero" autoFocus />
        </Field>

        <Field label={direction === 'in' ? 'From account' : 'Into account'}>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value as ID)}>
            <option value="">Choose an account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Date">
          <DateInput value={date} onChange={setDate} />
        </Field>

        {direction === 'out' && (
          <Notice tone="neutral" icon={<Flag className="size-4" />}>
            This goal holds <Money value={saved} currency={goal.currency} size="sm" />.
          </Notice>
        )}

        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}

export { addDays };
