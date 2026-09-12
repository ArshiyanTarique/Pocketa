import * as React from 'react';
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  Info,
  Plus,
  TriangleAlert,
  Wallet,
  CarFront,
  HandCoins,
  PieChart,
} from 'lucide-react';
import { Button, ExpandingRow, Progress, SectionLabel } from '../ui/primitives';
import { Money, Num } from '../ui/Money';
import { Reckoning } from '../ui/Reckoning';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toast';
import { TransactionRow } from '../components/TransactionRow';
import { AccountFan, NoteCard } from '../components/AccountFan';
import { Link, navigate } from '../app/router';
import { useAccountMap, useBalances, useOverview, useToday } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { summarisePeriod as summariseCarpool } from '../core/carpool';
import { balanceOfBase, live } from '../core/projections';
import { formatDate, formatRelativeDay, monthRange } from '../core/dates';
import { cn } from '../ui/cn';
import type { Account } from '../core/types';
import type { BudgetStatus } from '../core/projections';

/**
 * Home answers one question — can I spend, and is anything wrong? — and then
 * gets out of the way.
 *
 * It used to be nine cards and forty numbers. Now it is: the figure, the
 * accounts, three numbers for the month, and then a list of *status lines*
 * that only appear when they have something to say — a bill overdue, a budget
 * heading over, someone owing you, trips unbilled. Each line opens in place;
 * each ends with a way through to its screen. Nothing on this page is a chart.
 */
export function Dashboard({ onQuickAdd }: { onQuickAdd: () => void }) {
  const accounts = useAccountMap();
  const transactions = useStore((s) => s.transactions);
  const settings = useStore((s) => s.settings);
  const overview = useOverview();
  const asOf = useToday();
  const hidden = settings.hideAmounts;
  const currency = settings.baseCurrency;

  const hasActivity = live(transactions).length > 0;

  const recent = React.useMemo(
    () =>
      live(transactions)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
        .slice(0, 3),
    [transactions],
  );

  if (!hasActivity) return <FirstRun onQuickAdd={onQuickAdd} />;

  return (
    <div className="space-y-7">
      <SafeToSpendHero />

      <section>
        <SectionLabel
          to="/accounts"
          count={
            <Money value={overview.netWorth.net} currency={currency} hidden={hidden} size="sm" weight="semibold" symbol={false} compact />
          }
        >
          Accounts
        </SectionLabel>
        <div className="mt-1">
          <AccountFan onAdd={() => navigate('/accounts')} />
        </div>
      </section>

      <MonthFigures />

      <StatusLines />

      <section>
        <SectionLabel to="/transactions">Recent</SectionLabel>
        <ul className="mt-1 divide-y divide-line">
          {recent.map((txn) => (
            <li key={txn.id}>
              <TransactionRow
                txn={txn}
                accounts={accounts}
                hidden={hidden}
                showDate
                dateLabel={formatRelativeDay(txn.date, asOf)}
                onClick={() => navigate(`/transactions/${txn.id}`)}
                className="rounded-[--radius] px-2"
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------

function SafeToSpendHero() {
  const [explaining, setExplaining] = React.useState(false);
  const settings = useStore((s) => s.settings);
  const { safeToSpend } = useOverview();
  const hidden = settings.hideAmounts;
  const currency = settings.baseCurrency;

  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label">Safe to spend · {safeToSpend.horizonDays} days</p>
          <div className="count-in mt-2">
            <Money
              value={safeToSpend.amount}
              currency={currency}
              hidden={hidden}
              size="display"
              weight="semibold"
              tone={safeToSpend.shortfall ? 'negative' : 'default'}
            />
          </div>
        </div>
        <button
          onClick={() => setExplaining(true)}
          className={cn(
            'mb-1 flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5',
            'text-xs font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent',
          )}
        >
          <Info className="size-3.5" />
          How?
        </button>
      </div>
      <div className="reckoning-rule reckoning-rule--total mt-4" aria-hidden="true" />

      <Sheet
        open={explaining}
        onClose={() => setExplaining(false)}
        title="How this is worked out"
        description="Shown so you can check it. A budgeting calculation, not financial advice."
      >
        <div className="space-y-4 pb-2">
          <Reckoning
            currency={currency}
            hidden={hidden}
            lines={safeToSpend.lines.map((l) => ({
              key: l.key,
              label: l.label,
              detail: l.detail,
              amount: l.amount,
              emphasis: l.kind === 'start',
            }))}
            total={{ label: 'Safe to spend', amount: safeToSpend.amount }}
          />
          <p className="text-xs text-ink-3">
            Horizon ends {formatDate(safeToSpend.horizonDate)}. Change it in Settings.
          </p>
        </div>
      </Sheet>
    </section>
  );
}

// ---------------------------------------------------------------------------
// This month: three figures, one row, no boxes
// ---------------------------------------------------------------------------

function MonthFigures() {
  const { month } = useOverview();
  const settings = useStore((s) => s.settings);
  const hidden = settings.hideAmounts;
  const currency = settings.baseCurrency;
  const kept = month.savings >= 0;
  const shared = { currency, hidden };

  return (
    <section className="grid grid-cols-3 divide-x divide-line">
      <MonthFigure label="In" value={month.income} tone="positive" {...shared} />
      <div className="pl-4">
        <MonthFigure label="Out" value={month.expenses} {...shared} />
      </div>
      <div className="pl-4">
        <MonthFigure label={kept ? 'Kept' : 'Over'} value={Math.abs(month.savings)} tone={kept ? 'default' : 'negative'} {...shared} />
      </div>
    </section>
  );
}

function MonthFigure({
  label,
  value,
  tone = 'default',
  currency,
  hidden,
}: {
  label: string;
  value: number;
  tone?: 'positive' | 'negative' | 'default';
  currency: string;
  hidden: boolean;
}) {
  return (
    <button type="button" onClick={() => navigate('/analytics')} className="group flex flex-col gap-1 px-1 text-left">
      <span className="label group-hover:text-ink-2">{label}</span>
      <Money value={value} currency={currency} hidden={hidden} size="lg" weight="semibold" symbol={false} compact tone={tone} animate />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status lines — present only when there is something to say
// ---------------------------------------------------------------------------

function StatusLines() {
  const overview = useOverview();
  const settings = useStore((s) => s.settings);
  const accounts = useStore((s) => s.accounts);
  const people = useStore((s) => s.people);
  const carpools = useStore((s) => s.carpools);
  const carpoolRiders = useStore((s) => s.carpoolRiders);
  const carpoolTrips = useStore((s) => s.carpoolTrips);
  const balances = useBalances();
  const asOf = useToday();
  const hidden = settings.hideAmounts;
  const currency = settings.baseCurrency;

  const [open, setOpen] = React.useState<string | null>(null);
  const toggle = (key: string) => setOpen((k) => (k === key ? null : key));

  // --- the facts ------------------------------------------------------------
  const overdue = overview.overdue;
  const soon = overview.bills.filter((b) => b.status !== 'overdue' && b.daysUntilDue <= 7).slice(0, 3);
  const atRisk = overview.budgets.filter((b) => b.health === 'over' || (b.health === 'projected_over' && b.projectionReliable));

  const owed = React.useMemo(
    () =>
      accounts
        .filter((a) => a.class === 'receivable' && !a.archived)
        .map((a) => ({ id: a.id, name: people.find((p) => p.id === a.personId)?.name ?? a.name, amount: balanceOfBase(balances, a.id) }))
        .filter((r) => r.amount > 0)
        .sort((x, y) => y.amount - x.amount),
    [accounts, people, balances],
  );
  const owing = React.useMemo(
    () =>
      accounts
        .filter((a) => a.class === 'payable' && !a.archived)
        .map((a) => ({ id: a.id, name: people.find((p) => p.id === a.personId)?.name ?? a.name, amount: -balanceOfBase(balances, a.id) }))
        .filter((r) => r.amount > 0)
        .sort((x, y) => y.amount - x.amount),
    [accounts, people, balances],
  );
  const totalOwed = owed.reduce((s, r) => s + r.amount, 0);
  const totalOwing = owing.reduce((s, r) => s + r.amount, 0);

  const carpool = carpools.find((c) => !c.archived) ?? null;
  const tally = React.useMemo(() => {
    if (!carpool) return null;
    const riders = carpoolRiders.filter((r) => r.carpoolId === carpool.id);
    const trips = carpoolTrips.filter((t) => t.carpoolId === carpool.id);
    return summariseCarpool({ carpool, riders, trips, people, range: monthRange(asOf) });
  }, [carpool, carpoolRiders, carpoolTrips, people, asOf]);

  const lines: React.ReactNode[] = [];

  // --- overdue --------------------------------------------------------------
  if (overdue.length > 0) {
    lines.push(
      <ExpandingRow
        key="overdue"
        tone="negative"
        open={open === 'overdue'}
        onToggle={() => toggle('overdue')}
        leading={<TriangleAlert className="size-4 text-negative" />}
        summary={
          <span className="text-sm font-semibold text-ink">
            {overdue.length === 1
              ? `${overdue[0].recurrence.name} overdue ${Math.abs(overdue[0].daysUntilDue)}d`
              : `${overdue.length} bills overdue`}
          </span>
        }
        trailing={<Money value={overdue.reduce((s, b) => s + b.amount, 0)} currency={currency} hidden={hidden} size="sm" weight="semibold" symbol={false} tone="negative" />}
      >
        <ul className="divide-y divide-line">
          {overdue.map((b) => (
            <li key={b.key} className="flex items-center justify-between py-2 text-sm">
              <span className="text-ink">{b.recurrence.name}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-negative">{Math.abs(b.daysUntilDue)}d late</span>
                <Money value={b.amount} currency={currency} hidden={hidden} size="sm" symbol={false} />
              </span>
            </li>
          ))}
        </ul>
        <Through to="/bills">Record them</Through>
      </ExpandingRow>,
    );
  }

  // --- due soon -------------------------------------------------------------
  if (soon.length > 0) {
    lines.push(
      <ExpandingRow
        key="soon"
        open={open === 'soon'}
        onToggle={() => toggle('soon')}
        leading={<CalendarClock className="size-4 text-ink-3" />}
        summary={
          <span className="text-sm text-ink">
            <span className="font-semibold">{soon[0].recurrence.name}</span>
            <span className="text-ink-3"> {formatRelativeDay(soon[0].dueDate, asOf).toLowerCase()}</span>
            {soon.length > 1 && <span className="text-ink-3"> +{soon.length - 1}</span>}
          </span>
        }
        trailing={<Money value={soon[0].amount} currency={currency} hidden={hidden} size="sm" weight="semibold" symbol={false} />}
      >
        <ul className="divide-y divide-line">
          {soon.map((b) => (
            <li key={b.key} className="flex items-center justify-between py-2 text-sm">
              <span className="text-ink">{b.recurrence.name}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-ink-3">{formatRelativeDay(b.dueDate, asOf)}</span>
                <Money value={b.amount} currency={currency} hidden={hidden} size="sm" symbol={false} />
              </span>
            </li>
          ))}
        </ul>
        <Through to="/bills">All bills</Through>
      </ExpandingRow>,
    );
  }

  // --- budgets --------------------------------------------------------------
  if (atRisk.length > 0) {
    lines.push(
      <ExpandingRow
        key="budgets"
        tone="warn"
        open={open === 'budgets'}
        onToggle={() => toggle('budgets')}
        leading={<PieChart className="size-4 text-warn" />}
        summary={
          <span className="text-sm font-semibold text-ink">
            {atRisk.length === 1
              ? `${atRisk[0].budget.name} ${atRisk[0].health === 'over' ? 'over budget' : 'heading over'}`
              : `${atRisk.length} budgets at risk`}
          </span>
        }
        trailing={<BudgetHint status={atRisk[0]} currency={currency} hidden={hidden} />}
      >
        <ul className="space-y-3 pt-1">
          {atRisk.map((b) => (
            <li key={b.budget.id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold text-ink">{b.budget.name}</span>
                <BudgetHint status={b} currency={currency} hidden={hidden} />
              </div>
              <Progress
                value={b.used}
                tone={b.health === 'over' ? 'negative' : 'warn'}
                marker={b.daysTotal > 0 ? b.daysElapsed / b.daysTotal : undefined}
                label={`${b.budget.name} budget`}
              />
            </li>
          ))}
        </ul>
        <Through to="/budgets">All budgets</Through>
      </ExpandingRow>,
    );
  } else if (overview.budgets.length > 0) {
    lines.push(
      <QuietLine key="budgets-ok" to="/budgets" icon={<PieChart className="size-4 text-ink-4" />}>
        {overview.budgets.length} budget{overview.budgets.length === 1 ? '' : 's'} on track
      </QuietLine>,
    );
  }

  // --- people ---------------------------------------------------------------
  if (owed.length + owing.length > 0) {
    const net = totalOwed - totalOwing;
    const one = owed.length + owing.length === 1 ? (owed[0] ?? owing[0]) : null;
    lines.push(
      <ExpandingRow
        key="people"
        tone={net > 0 ? 'positive' : net < 0 ? 'negative' : null}
        open={open === 'people'}
        onToggle={() => toggle('people')}
        leading={<HandCoins className={cn('size-4', net > 0 ? 'text-positive' : net < 0 ? 'text-negative' : 'text-ink-3')} />}
        summary={
          <span className="text-sm text-ink">
            {one ? (
              <>
                <span className="font-semibold">{one.name}</span>
                <span className="text-ink-3">{owed.length ? ' owes you' : ' is owed'}</span>
              </>
            ) : (
              <>
                <span className="font-semibold">{owed.length} owe you</span>
                {owing.length > 0 && <span className="text-ink-3"> · you owe {owing.length}</span>}
              </>
            )}
          </span>
        }
        trailing={<Money value={net} currency={currency} hidden={hidden} size="sm" weight="semibold" symbol={false} sign="always" tone="auto" />}
      >
        <ul className="divide-y divide-line">
          {owed.map((r) => (
            <PersonLine key={r.id} name={r.name} amount={r.amount} tone="positive" hidden={hidden} currency={currency} />
          ))}
          {owing.map((r) => (
            <PersonLine key={r.id} name={r.name} amount={-r.amount} tone="negative" hidden={hidden} currency={currency} />
          ))}
        </ul>
        <Through to="/debts">Settle up</Through>
      </ExpandingRow>,
    );
  }

  // --- carpool --------------------------------------------------------------
  if (tally && tally.outstanding > 0) {
    lines.push(
      <ExpandingRow
        key="carpool"
        tone="accent"
        open={open === 'carpool'}
        onToggle={() => toggle('carpool')}
        leading={<CarFront className="size-4 text-accent" />}
        summary={
          <span className="text-sm text-ink">
            <span className="font-semibold">Carpool</span>
            <span className="text-ink-3">
              {' '}
              <Num size="sm">{tally.unbilledTripCount}</Num> trip{tally.unbilledTripCount === 1 ? '' : 's'} unbilled
            </span>
          </span>
        }
        trailing={<Money value={tally.outstanding} currency={currency} hidden={hidden} size="sm" weight="semibold" symbol={false} />}
      >
        <ul className="divide-y divide-line">
          {tally.riders
            .filter((r) => r.amount > 0)
            .map((r) => (
              <li key={r.rider.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink">
                  {r.name} <span className="text-xs text-ink-3">· {r.unbilledTrips} trip{r.unbilledTrips === 1 ? '' : 's'}</span>
                </span>
                <Money value={r.amount} currency={currency} hidden={hidden} size="sm" symbol={false} />
              </li>
            ))}
        </ul>
        <Through to="/carpool">Bill the month</Through>
      </ExpandingRow>,
    );
  }

  if (lines.length === 0) return null;

  return (
    <section>
      <SectionLabel>Right now</SectionLabel>
      <div className="mt-1 divide-y divide-line rounded-[--radius] border border-line bg-surface">{lines}</div>
    </section>
  );
}

/** A line with nothing to open — a fact, and a way through. */
function QuietLine({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex min-h-12 items-center gap-3 border-l-[3px] border-l-transparent px-3 py-2.5 text-sm text-ink-3 transition-colors hover:bg-surface-2/60 hover:text-ink">
      {icon}
      <span className="flex-1">{children}</span>
      <ArrowRight className="size-4 text-ink-4" />
    </Link>
  );
}

/** The link at the foot of an opened line. */
function Through({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="mt-3 inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-accent hover:underline">
      {children}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

function PersonLine({
  name,
  amount,
  tone,
  hidden,
  currency,
}: {
  name: string;
  amount: number;
  tone: 'positive' | 'negative';
  hidden: boolean;
  currency: string;
}) {
  return (
    <li className="flex items-center justify-between py-2 text-sm">
      <span className="text-ink">{name}</span>
      <Money value={amount} currency={currency} hidden={hidden} size="sm" symbol={false} sign="always" tone={tone} />
    </li>
  );
}

export function BudgetHint({
  status,
  currency,
  hidden,
}: {
  status: BudgetStatus;
  currency: string;
  hidden: boolean;
}) {
  if (status.health === 'over') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-negative">
        <CircleAlert className="size-3" />
        <Money value={-status.remaining} currency={currency} hidden={hidden} size="xs" symbol={false} className="text-negative" /> over
      </span>
    );
  }
  if (status.health === 'projected_over' && status.projectionReliable) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-warn">
        <TriangleAlert className="size-3" />
        → <Money value={status.projected} currency={currency} hidden={hidden} size="xs" symbol={false} className="text-warn" />
      </span>
    );
  }
  return (
    <span className="shrink-0 text-xs text-ink-3">
      <Money value={status.remaining} currency={currency} hidden={hidden} size="xs" symbol={false} /> left
    </span>
  );
}

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------

function FirstRun({ onQuickAdd }: { onQuickAdd: () => void }) {
  const steps = [
    { title: 'Add an account', hint: 'What is in it today', icon: Wallet, to: '/accounts' },
    { title: 'Record a spend', hint: 'Amount, category, done', icon: Plus, onClick: onQuickAdd },
    { title: 'Add your bills', hint: 'So they are reserved before you spend', icon: CalendarClock, to: '/bills' },
  ];

  return (
    <div className="py-2 sm:py-6">
      <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
        <div>
          <p className="label">Start here</p>
          <h1 className="display mt-2 text-[2.5rem] leading-[0.95] sm:text-[3.5rem]">
            Where do you
            <br />
            stand?
          </h1>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <SampleDataButton />
            <button onClick={() => navigate('/settings/data')} className="text-[0.8125rem] font-semibold text-accent hover:underline">
              Import a CSV instead
            </button>
          </div>
        </div>
        <PreviewFan />
      </div>

      <ol className="stagger mt-10 grid gap-3 sm:grid-cols-3">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.title}>
              <button
                type="button"
                onClick={() => (step.onClick ? step.onClick() : navigate(step.to!))}
                className="card group flex h-full w-full flex-col gap-4 px-5 py-5 text-left transition-transform hover:-translate-y-0.5"
              >
                <span className="flex items-center justify-between">
                  <span className="tnum flex size-9 items-center justify-center rounded-full bg-accent-fill text-sm font-semibold text-[--accent-ink]">
                    {i + 1}
                  </span>
                  <Icon className="size-5 text-ink-3 transition-colors group-hover:text-accent" />
                </span>
                <span>
                  <span className="display block text-[1.125rem]">{step.title}</span>
                  <span className="mt-1 block text-[0.8125rem] text-ink-3">{step.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Three notes, fanned, so an empty ledger still shows the shape of a full one. */
function PreviewFan() {
  const now = '2026-01-01T00:00:00.000Z';
  const sample = (id: string, cls: Account['class'], name: string, institution?: string): Account => ({
    id,
    class: cls,
    name,
    parentId: null,
    currency: 'PKR',
    icon: null,
    color: null,
    archived: false,
    archivedAt: null,
    system: false,
    sortOrder: 0,
    notes: null,
    institution: institution ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const cards = [
    { account: sample('demo-cash', 'cash', 'Wallet'), balance: 1240000, tilt: '-8deg', x: '0rem', y: '2.5rem' },
    { account: sample('demo-bank', 'bank', 'Meezan', 'Current'), balance: 31020000, tilt: '-1deg', x: '3.5rem', y: '0.75rem' },
    { account: sample('demo-card', 'credit_card', 'HBL Card', '···· 4412'), balance: -1842000, tilt: '7deg', x: '7rem', y: '0rem' },
  ];

  return (
    <div className="stagger relative mx-auto h-[15rem] w-full max-w-[22rem] select-none sm:h-[17rem]" aria-hidden="true">
      {cards.map((c, i) => (
        <div
          key={c.account.id}
          className="absolute left-0 top-0 transition-transform duration-500 hover:z-10 hover:-translate-y-2"
          style={{ transform: `translate(${c.x}, ${c.y}) rotate(${c.tilt})`, transformOrigin: 'bottom left', zIndex: i }}
        >
          <NoteCard
            account={c.account}
            balance={c.balance}
            credit={c.account.class === 'credit_card' ? 1158000 : null}
            hidden={false}
            size="lg"
            className="pointer-events-none"
          />
        </div>
      ))}
    </div>
  );
}

function SampleDataButton() {
  const loadSampleData = useStore((s) => s.loadSampleData);
  const [loading, setLoading] = React.useState(false);

  return (
    <Button
      variant="primary"
      size="lg"
      loading={loading}
      icon={<ArrowRight className="size-4" />}
      onClick={async () => {
        setLoading(true);
        const result = await loadSampleData();
        setLoading(false);
        toast.saved(`Loaded ${result.created} sample transactions`, { label: 'Start fresh', run: () => navigate('/settings/data') });
      }}
    >
      Explore with sample data
    </Button>
  );
}
