import * as React from 'react';
import { ChartNoAxesCombined, ChevronLeft, ChevronRight, Store } from 'lucide-react';
import { Badge, Button, EmptyState, ExpandingRow, IconButton, Segmented } from '../ui/primitives';
import { Money, Num, Percent } from '../ui/Money';
import { CategoryBars, DailyBars, IncomeExpenseBars, NetWorthChart, Sparkline } from '../ui/charts';
import { TransactionRow } from '../components/TransactionRow';
import { cn } from '../ui/cn';
import { navigate } from '../app/router';
import { useAccountMap, useToday } from '../app/useLedger';
import { useStore } from '../store/useStore';
import {
  categoryBreakdown,
  categoryTrend,
  dailySpendSeries,
  largestExpenses,
  live,
  merchantSpending,
  monthlyTrend,
  netWorthSeries,
  rollUpToParents,
  summarisePeriod,
  type CategorySlice,
} from '../core/projections';
import { addMonths, formatDate, monthRange, yearRange, type DateRange } from '../core/dates';
import type { ID } from '../core/types';

type Period = 'month' | 'year';
type ChartKind = 'flow' | 'worth' | 'daily';
type ListKind = 'categories' | 'merchants' | 'largest';

/**
 * One question at a time. The old page answered nine questions at once with
 * nine cards; this one has a period, one chart you switch, and one list you
 * switch. Everything that used to be its own card is a segment or a row.
 */
export function Analytics() {
  const transactions = useStore((s) => s.transactions);
  const settings = useStore((s) => s.settings);
  const accounts = useAccountMap();
  const asOf = useToday();
  const hidden = settings.hideAmounts;
  const currency = settings.baseCurrency;

  const [period, setPeriod] = React.useState<Period>('month');
  const [offset, setOffset] = React.useState(0);
  const [chart, setChart] = React.useState<ChartKind>('flow');
  const [list, setList] = React.useState<ListKind>('categories');
  const [openCategory, setOpenCategory] = React.useState<ID | null>(null);

  const anchor = period === 'month' ? addMonths(asOf, -offset) : `${Number(asOf.slice(0, 4)) - offset}-06-15`;
  const range: DateRange = period === 'month' ? monthRange(anchor) : yearRange(anchor);
  const label = period === 'month' ? formatDate(range.from, 'month') : range.from.slice(0, 4);

  const summary = React.useMemo(
    () => summarisePeriod(transactions, accounts, range, offset === 0 ? asOf : range.to),
    [transactions, accounts, range, offset, asOf],
  );
  const previous = React.useMemo(() => {
    const prevRange =
      period === 'month' ? monthRange(addMonths(anchor, -1)) : yearRange(`${Number(anchor.slice(0, 4)) - 1}-06-15`);
    return summarisePeriod(transactions, accounts, prevRange, prevRange.to);
  }, [transactions, accounts, anchor, period]);

  const subBreakdown = React.useMemo(() => categoryBreakdown(transactions, accounts, range), [transactions, accounts, range]);
  const breakdown = React.useMemo(() => rollUpToParents(subBreakdown, accounts), [subBreakdown, accounts]);
  const trend = React.useMemo(() => monthlyTrend(transactions, accounts, 12, asOf), [transactions, accounts, asOf]);
  const worth = React.useMemo(() => netWorthSeries(transactions, accounts, 12, asOf), [transactions, accounts, asOf]);
  const daily = React.useMemo(() => dailySpendSeries(transactions, accounts, range), [transactions, accounts, range]);
  const categoryIds = React.useMemo(() => breakdown.map((b) => b.accountId), [breakdown]);
  const trends = React.useMemo(
    () => categoryTrend(transactions, accounts, categoryIds, 6, asOf),
    [transactions, accounts, categoryIds, asOf],
  );
  const merchants = React.useMemo(() => merchantSpending(transactions, accounts, range, 10), [transactions, accounts, range]);
  const largest = React.useMemo(() => largestExpenses(transactions, accounts, range, 8), [transactions, accounts, range]);

  const hasData = live(transactions).length > 0;
  const expenseChange = previous.expenses > 0 ? (summary.expenses - previous.expenses) / previous.expenses : null;

  if (!hasData) {
    return (
      <EmptyState
        icon={<ChartNoAxesCombined className="size-5" />}
        title="Nothing to analyse yet"
        body="A few weeks of activity and this page will show where the money goes."
        action={<Button variant="primary" onClick={() => navigate('/')}>Home</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Period ------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Period"
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setOffset(0);
          }}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'year', label: 'Year' },
          ]}
        />
        <div className="flex items-center gap-1">
          <IconButton label="Previous period" onClick={() => setOffset((o) => o + 1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <span className="display min-w-[8rem] text-center text-[1.0625rem]">{label}</span>
          <IconButton label="Next period" onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      </div>

      {/* The three figures -------------------------------------------------- */}
      <div className="grid grid-cols-3 divide-x divide-line">
        <Figure label="In">
          <Money value={summary.income} currency={currency} hidden={hidden} size="base" weight="semibold" symbol={false} animate tone="positive" />
        </Figure>
        <Figure
          label="Out"
          badge={
            expenseChange != null && Math.abs(expenseChange) > 0.005 ? (
              <Badge tone={expenseChange > 0 ? 'negative' : 'positive'}>
                {expenseChange > 0 ? '+' : '−'}
                <Percent value={Math.abs(expenseChange)} size="xs" />
              </Badge>
            ) : null
          }
        >
          <Money value={summary.expenses} currency={currency} hidden={hidden} size="base" weight="semibold" symbol={false} animate />
        </Figure>
        <Figure label={summary.savings >= 0 ? 'Kept' : 'Overspent'} hint={summary.savingsRate != null ? <Percent value={Math.abs(summary.savingsRate)} size="xs" /> : null}>
          <Money
            value={Math.abs(summary.savings)}
            currency={currency}
            hidden={hidden}
            size="base"
            weight="semibold"
            symbol={false}
            tone={summary.savings < 0 ? 'negative' : 'default'}
          />
        </Figure>
      </div>

      {/* One chart ---------------------------------------------------------- */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label="Chart"
            value={chart}
            onChange={setChart}
            options={[
              { value: 'flow', label: 'Cash flow' },
              { value: 'worth', label: 'Net worth' },
              { value: 'daily', label: 'Daily' },
            ]}
          />
          <span className="text-xs text-ink-4">
            {chart === 'daily' ? label : 'Last 12 months'}
          </span>
        </div>

        <div className="mt-4">
          {chart === 'flow' && (
            <>
              <IncomeExpenseBars data={trend} currency={currency} hidden={hidden} height={150} />
              <div className="mt-3 flex gap-4 text-xs text-ink-3">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-positive-fill/85" aria-hidden="true" /> In
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-negative-fill/75" aria-hidden="true" /> Out
                </span>
              </div>
            </>
          )}
          {chart === 'worth' && <NetWorthChart data={worth} currency={currency} hidden={hidden} height={180} />}
          {chart === 'daily' && (
            <>
              <DailyBars data={daily} currency={currency} hidden={hidden} average={summary.averageDailySpend} height={120} />
              <p className="mt-2 text-xs text-ink-3">
                Dashed line: average of{' '}
                <Money value={summary.averageDailySpend} currency={currency} hidden={hidden} size="xs" symbol={false} /> a day ·{' '}
                <Num size="xs">{summary.txnCount}</Num> transactions
              </p>
            </>
          )}
        </div>
      </section>

      {/* One list ----------------------------------------------------------- */}
      <section>
        <Segmented
          label="Breakdown"
          value={list}
          onChange={setList}
          options={[
            { value: 'categories', label: 'Categories' },
            { value: 'merchants', label: 'Merchants' },
            { value: 'largest', label: 'Largest' },
          ]}
        />

        <div className="mt-3 rounded-[--radius] border border-line bg-surface">
          {list === 'categories' &&
            (breakdown.length === 0 ? (
              <EmptyState compact title="No spending in this period" />
            ) : (
              <ul className="divide-y divide-line">
                {breakdown.map((slice) => (
                  <li key={slice.accountId}>
                    <CategoryRow
                      slice={slice}
                      peak={breakdown[0]?.amount ?? 1}
                      children_={subBreakdown.filter((s) => s.parentId === slice.accountId)}
                      series={trends.map((t) => t.byCategory[slice.accountId] ?? 0)}
                      currency={currency}
                      hidden={hidden}
                      open={openCategory === slice.accountId}
                      onToggle={() => setOpenCategory((id) => (id === slice.accountId ? null : slice.accountId))}
                    />
                  </li>
                ))}
              </ul>
            ))}

          {list === 'merchants' &&
            (merchants.length === 0 ? (
              <EmptyState compact icon={<Store className="size-5" />} title="No merchants recorded" body="Name the place when you record an expense and it ranks here." />
            ) : (
              <ul className="divide-y divide-line">
                {merchants.map((m) => (
                  <li key={m.merchant}>
                    <button
                      type="button"
                      onClick={() => navigate(`/transactions?q=${encodeURIComponent(m.merchant)}`)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{m.merchant}</span>
                        <span className="block text-xs text-ink-3">
                          <Num size="xs">{m.txnCount}</Num> {m.txnCount === 1 ? 'visit' : 'visits'} · last {formatDate(m.lastDate, 'short')}
                        </span>
                      </span>
                      <Money value={m.amount} currency={currency} hidden={hidden} size="sm" weight="medium" symbol={false} />
                    </button>
                  </li>
                ))}
              </ul>
            ))}

          {list === 'largest' &&
            (largest.length === 0 ? (
              <EmptyState compact title="No expenses in this period" />
            ) : (
              <ul className="divide-y divide-line">
                {largest.map((item) => (
                  <li key={item.txn.id}>
                    <TransactionRow
                      txn={item.txn}
                      accounts={accounts}
                      hidden={hidden}
                      showDate
                      dateLabel={formatDate(item.txn.date, 'short')}
                      onClick={() => navigate(`/transactions/${item.txn.id}`)}
                      className="px-3"
                    />
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Figure({
  label,
  badge,
  hint,
  children,
}: {
  label: string;
  badge?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 first:pl-0 last:pr-0">
      <span className="label flex items-center gap-1.5">
        {label}
        {hint && <span className="tnum normal-case tracking-normal text-ink-4">{hint}</span>}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-2">
        {children}
        {badge}
      </span>
    </div>
  );
}

function CategoryRow({
  slice,
  peak,
  children_,
  series,
  currency,
  hidden,
  open,
  onToggle,
}: {
  slice: CategorySlice;
  peak: number;
  children_: CategorySlice[];
  series: number[];
  currency: string;
  hidden: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const latest = series[series.length - 1] ?? 0;
  const prior = series.slice(0, -1).filter((v) => v > 0);
  const average = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
  const change = average > 0 ? (latest - average) / average : null;
  const up = change != null && change > 0.05;
  const down = change != null && change < -0.05;

  return (
    <ExpandingRow
      open={open}
      onToggle={onToggle}
      leading={
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: slice.color ?? 'var(--ink-4)' }} aria-hidden="true" />
      }
      summary={
        <span className="block pr-2">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium text-ink">{slice.name}</span>
            <span className="tnum shrink-0 text-xs text-ink-4">
              <Percent value={slice.share} size="xs" />
            </span>
          </span>
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.max(2, (slice.amount / peak) * 100)}%`, background: slice.color ?? 'var(--accent-fill)' }}
            />
          </span>
        </span>
      }
      trailing={
        <span className="flex items-center gap-3">
          <Sparkline
            values={series}
            height={22}
            fill={false}
            tone={up ? 'negative' : down ? 'positive' : 'accent'}
            className={cn('hidden w-16 sm:block', series.every((v) => v === 0) && 'invisible')}
          />
          <Money value={slice.amount} currency={currency} hidden={hidden} size="sm" weight="semibold" symbol={false} className="w-[4.5rem] text-right" />
        </span>
      }
    >
      {children_.length > 0 && (
        <CategoryBars
          slices={children_.map((s) => ({ key: s.accountId, label: s.name, amount: s.amount, color: s.color ?? slice.color }))}
          currency={currency}
          hidden={hidden}
          max={slice.amount}
          onSelect={(id) => navigate(`/transactions?category=${id}`)}
        />
      )}
      <div className={cn('flex flex-wrap items-center justify-between gap-2', children_.length > 0 && 'mt-3')}>
        <span className="text-xs text-ink-3">
          {change == null
            ? 'Not enough history to compare'
            : up
              ? <>Above its six-month average by <Percent value={change} size="xs" className="text-negative" /></>
              : down
                ? <>Below its six-month average by <Percent value={-change} size="xs" className="text-positive" /></>
                : 'About the same as usual'}
          {' · '}
          <Num size="xs">{slice.txnCount}</Num> {slice.txnCount === 1 ? 'transaction' : 'transactions'}
        </span>
        <Button size="sm" variant="secondary" onClick={() => navigate(`/transactions?category=${slice.accountId}`)}>
          Transactions
        </Button>
      </div>
    </ExpandingRow>
  );
}
