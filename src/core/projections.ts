/**
 * Projections — the read model.
 *
 * Nothing here is stored. Every figure the app shows is summed from the ledger
 * on demand, which is what makes principle #8 true: a balance cannot drift out
 * of sync with its transactions, because it has no independent existence.
 *
 * Voided transactions are excluded from every figure but retained in storage,
 * so deleting is reversible and history is never destroyed (principle #9).
 */

import { sumMinor } from './money';
import {
  addDays,
  addMonths,
  daysBetween,
  daysElapsed,
  daysRemaining,
  endOfMonth,
  monthRange,
  rangeLengthDays,
  startOfMonth,
  today,
  type CalendarDate,
  type DateRange,
} from './dates';
import {
  affectsNetWorth,
  isAsset,
  isLiability,
  LIQUID_CLASSES,
  type Account,
  type Budget,
  type ID,
  type Transaction,
} from './types';

export type AccountMap = ReadonlyMap<ID, Account>;

/** Transactions that count. Voided rows stay in storage but never in a total. */
export function live(txns: readonly Transaction[]): Transaction[] {
  return txns.filter((t) => !t.voided);
}

export function inRange(txns: readonly Transaction[], range: DateRange): Transaction[] {
  return txns.filter((t) => t.date >= range.from && t.date <= range.to);
}

export function upTo(txns: readonly Transaction[], asOf: CalendarDate): Transaction[] {
  return txns.filter((t) => t.date <= asOf);
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export interface Balances {
  /** In each account's own currency — what the account page shows. */
  native: Map<ID, number>;
  /** In the ledger base currency — what totals and net worth use. */
  base: Map<ID, number>;
}

export function computeBalances(txns: readonly Transaction[]): Balances {
  const native = new Map<ID, number>();
  const base = new Map<ID, number>();
  for (const t of txns) {
    if (t.voided) continue;
    for (const p of t.postings) {
      native.set(p.accountId, (native.get(p.accountId) ?? 0) + p.amount);
      base.set(p.accountId, (base.get(p.accountId) ?? 0) + p.baseAmount);
    }
  }
  return { native, base };
}

export function balanceOf(balances: Balances, accountId: ID): number {
  return balances.native.get(accountId) ?? 0;
}

export function balanceOfBase(balances: Balances, accountId: ID): number {
  return balances.base.get(accountId) ?? 0;
}

/** Balance as at a date, for time-travel and net-worth history. */
export function balanceAsOf(
  txns: readonly Transaction[],
  accountId: ID,
  asOf: CalendarDate,
): number {
  return sumMinor(
    live(txns)
      .filter((t) => t.date <= asOf)
      .flatMap((t) => t.postings.filter((p) => p.accountId === accountId).map((p) => p.amount)),
  );
}

// ---------------------------------------------------------------------------
// Net worth
// ---------------------------------------------------------------------------

export interface NetWorth {
  assets: number;
  /** Positive number representing what is owed. */
  liabilities: number;
  net: number;
}

export function computeNetWorth(balances: Balances, accounts: AccountMap): NetWorth {
  let assets = 0;
  let liabilities = 0;
  for (const [id, amount] of balances.base) {
    const acc = accounts.get(id);
    if (!acc || acc.archived === undefined) continue;
    if (acc.excludeFromNetWorth) continue;
    if (!affectsNetWorth(acc.class)) continue;
    if (isAsset(acc.class)) assets += amount;
    else if (isLiability(acc.class)) liabilities += amount;
  }
  // Liability balances are negative; show them as a positive "owed" figure.
  // `+ 0` normalises -0 so "nothing owed" renders as Rs. 0, never −Rs. 0.
  return { assets: assets + 0, liabilities: -liabilities + 0, net: assets + liabilities + 0 };
}

export function netWorthAsOf(
  txns: readonly Transaction[],
  accounts: AccountMap,
  asOf: CalendarDate,
): NetWorth {
  return computeNetWorth(computeBalances(upTo(live(txns), asOf)), accounts);
}

/** Net worth at each month-end across a window, for the trend chart. */
export function netWorthSeries(
  txns: readonly Transaction[],
  accounts: AccountMap,
  months: number,
  asOf: CalendarDate = today(),
): Array<{ date: CalendarDate; net: number; assets: number; liabilities: number }> {
  const out: Array<{ date: CalendarDate; net: number; assets: number; liabilities: number }> = [];
  const visible = live(txns);
  for (let i = months - 1; i >= 0; i--) {
    const monthAnchor = addMonths(asOf, -i);
    const at = i === 0 ? asOf : endOfMonth(monthAnchor);
    const nw = computeNetWorth(computeBalances(upTo(visible, at)), accounts);
    out.push({ date: at, ...nw });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Income, expenses, savings
// ---------------------------------------------------------------------------

export interface PeriodSummary {
  range: DateRange;
  income: number;
  expenses: number;
  /** income − expenses. Negative when overspending. */
  savings: number;
  /** savings ÷ income, as a fraction. Null when there was no income. */
  savingsRate: number | null;
  txnCount: number;
  /** Mean spend per elapsed day in the period. */
  averageDailySpend: number;
}

function categorySum(
  txns: readonly Transaction[],
  accounts: AccountMap,
  cls: 'expense_category' | 'income_category',
): number {
  let total = 0;
  for (const t of txns) {
    for (const p of t.postings) {
      if (accounts.get(p.accountId)?.class === cls) total += p.baseAmount;
    }
  }
  return total;
}

export function summarisePeriod(
  txns: readonly Transaction[],
  accounts: AccountMap,
  range: DateRange,
  asOf: CalendarDate = today(),
): PeriodSummary {
  const rows = inRange(live(txns), range);
  const expenses = categorySum(rows, accounts, 'expense_category');
  const income = -categorySum(rows, accounts, 'income_category') + 0;
  const savings = income - expenses;
  const elapsed = Math.max(1, daysElapsed(range, asOf));
  return {
    range,
    income,
    expenses,
    savings,
    savingsRate: income > 0 ? savings / income : null,
    txnCount: rows.length,
    averageDailySpend: Math.round(expenses / elapsed),
  };
}

export function currentMonthSummary(
  txns: readonly Transaction[],
  accounts: AccountMap,
  asOf: CalendarDate = today(),
): PeriodSummary {
  return summarisePeriod(txns, accounts, monthRange(asOf), asOf);
}

// ---------------------------------------------------------------------------
// Category breakdown
// ---------------------------------------------------------------------------

export interface CategorySlice {
  accountId: ID;
  name: string;
  parentId: ID | null;
  color: string | null;
  icon: string | null;
  amount: number;
  /** Fraction of the period total. 0 when the total is zero. */
  share: number;
  txnCount: number;
}

export function categoryBreakdown(
  txns: readonly Transaction[],
  accounts: AccountMap,
  range: DateRange,
  cls: 'expense_category' | 'income_category' = 'expense_category',
): CategorySlice[] {
  const totals = new Map<ID, { amount: number; count: number }>();
  for (const t of inRange(live(txns), range)) {
    for (const p of t.postings) {
      const acc = accounts.get(p.accountId);
      if (acc?.class !== cls) continue;
      const cur = totals.get(p.accountId) ?? { amount: 0, count: 0 };
      cur.amount += cls === 'income_category' ? -p.baseAmount : p.baseAmount;
      cur.count += 1;
      totals.set(p.accountId, cur);
    }
  }

  const grand = [...totals.values()].reduce((s, v) => s + v.amount, 0);
  return [...totals.entries()]
    .map(([accountId, v]) => {
      const acc = accounts.get(accountId);
      return {
        accountId,
        name: acc?.name ?? 'Uncategorised',
        parentId: acc?.parentId ?? null,
        color: acc?.color ?? null,
        icon: acc?.icon ?? null,
        amount: v.amount,
        share: grand > 0 ? v.amount / grand : 0,
        txnCount: v.count,
      };
    })
    .filter((s) => s.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Roll subcategories into their parents for a top-level view. */
export function rollUpToParents(slices: CategorySlice[], accounts: AccountMap): CategorySlice[] {
  const merged = new Map<ID, CategorySlice>();
  for (const s of slices) {
    const key = s.parentId ?? s.accountId;
    const acc = accounts.get(key);
    const cur = merged.get(key);
    if (cur) {
      cur.amount += s.amount;
      cur.txnCount += s.txnCount;
    } else {
      merged.set(key, {
        ...s,
        accountId: key,
        parentId: null,
        name: acc?.name ?? s.name,
        color: acc?.color ?? s.color,
        icon: acc?.icon ?? s.icon,
      });
    }
  }
  const grand = [...merged.values()].reduce((sum, v) => sum + v.amount, 0);
  return [...merged.values()]
    .map((s) => ({ ...s, share: grand > 0 ? s.amount / grand : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export interface TrendPoint {
  date: CalendarDate;
  label: string;
  income: number;
  expenses: number;
  savings: number;
}

export function monthlyTrend(
  txns: readonly Transaction[],
  accounts: AccountMap,
  months: number,
  asOf: CalendarDate = today(),
): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const anchor = addMonths(asOf, -i);
    const range = monthRange(anchor);
    const s = summarisePeriod(txns, accounts, range, asOf);
    out.push({
      date: startOfMonth(anchor),
      label: startOfMonth(anchor),
      income: s.income,
      expenses: s.expenses,
      savings: s.savings,
    });
  }
  return out;
}

export function dailySpendSeries(
  txns: readonly Transaction[],
  accounts: AccountMap,
  range: DateRange,
): Array<{ date: CalendarDate; amount: number }> {
  const byDay = new Map<CalendarDate, number>();
  for (const t of inRange(live(txns), range)) {
    for (const p of t.postings) {
      if (accounts.get(p.accountId)?.class !== 'expense_category') continue;
      byDay.set(t.date, (byDay.get(t.date) ?? 0) + p.baseAmount);
    }
  }
  const out: Array<{ date: CalendarDate; amount: number }> = [];
  const n = daysBetween(range.from, range.to);
  for (let i = 0; i <= n; i++) {
    const d = addDays(range.from, i);
    out.push({ date: d, amount: byDay.get(d) ?? 0 });
  }
  return out;
}

/** Spending per category across several months, for the category-trend report. */
export function categoryTrend(
  txns: readonly Transaction[],
  accounts: AccountMap,
  categoryIds: readonly ID[],
  months: number,
  asOf: CalendarDate = today(),
): Array<{ date: CalendarDate; byCategory: Record<ID, number>; total: number }> {
  const out: Array<{ date: CalendarDate; byCategory: Record<ID, number>; total: number }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const anchor = addMonths(asOf, -i);
    const rows = inRange(live(txns), monthRange(anchor));
    const byCategory: Record<ID, number> = {};
    let total = 0;
    for (const id of categoryIds) byCategory[id] = 0;
    for (const t of rows) {
      for (const p of t.postings) {
        if (accounts.get(p.accountId)?.class !== 'expense_category') continue;
        if (!categoryIds.includes(p.accountId)) continue;
        byCategory[p.accountId] += p.baseAmount;
        total += p.baseAmount;
      }
    }
    out.push({ date: startOfMonth(anchor), byCategory, total });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Merchants and largest expenses
// ---------------------------------------------------------------------------

export interface MerchantSlice {
  merchant: string;
  amount: number;
  txnCount: number;
  lastDate: CalendarDate;
}

export function merchantSpending(
  txns: readonly Transaction[],
  accounts: AccountMap,
  range: DateRange,
  limit = 10,
): MerchantSlice[] {
  const map = new Map<string, MerchantSlice>();
  for (const t of inRange(live(txns), range)) {
    const spend = sumMinor(
      t.postings
        .filter((p) => accounts.get(p.accountId)?.class === 'expense_category')
        .map((p) => p.baseAmount),
    );
    if (spend <= 0) continue;
    const key = (t.merchant ?? 'Unspecified').trim() || 'Unspecified';
    const cur = map.get(key);
    if (cur) {
      cur.amount += spend;
      cur.txnCount += 1;
      if (t.date > cur.lastDate) cur.lastDate = t.date;
    } else {
      map.set(key, { merchant: key, amount: spend, txnCount: 1, lastDate: t.date });
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

export interface RankedExpense {
  txn: Transaction;
  amount: number;
}

export function largestExpenses(
  txns: readonly Transaction[],
  accounts: AccountMap,
  range: DateRange,
  limit = 10,
): RankedExpense[] {
  return inRange(live(txns), range)
    .map((txn) => ({
      txn,
      amount: sumMinor(
        txn.postings
          .filter((p) => accounts.get(p.accountId)?.class === 'expense_category')
          .map((p) => p.baseAmount),
      ),
    }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export type BudgetHealth = 'on_track' | 'warning' | 'projected_over' | 'over';

export interface BudgetStatus {
  budget: Budget;
  range: DateRange;
  /** budget.limit plus any carry. What is actually available this period. */
  limit: number;
  /** Unspent budget brought in from earlier periods. Zero unless rollover is on. */
  carry: number;
  spent: number;
  remaining: number;
  /** spent ÷ limit. Can exceed 1. */
  used: number;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  /** Linear projection of end-of-period spend from the pace so far. */
  projected: number;
  /**
   * False in the first days of a period, when too little has elapsed for a
   * linear projection to mean anything. One large shop on day one would
   * otherwise "project" to thirty times the budget and cry wolf.
   */
  projectionReliable: boolean;
  /** What could be spent per remaining day and still land on the limit. */
  safeDailyRemaining: number;
  health: BudgetHealth;
}

/** A projection needs both a few days and a reasonable share of the period. */
const MIN_DAYS_FOR_PROJECTION = 4;
const MIN_SHARE_FOR_PROJECTION = 0.15;

export function budgetRange(budget: Budget, asOf: CalendarDate = today()): DateRange {
  switch (budget.period) {
    case 'custom':
      return {
        from: budget.customFrom ?? startOfMonth(asOf),
        to: budget.customTo ?? endOfMonth(asOf),
      };
    case 'yearly':
      return { from: `${asOf.slice(0, 4)}-01-01`, to: `${asOf.slice(0, 4)}-12-31` };
    case 'weekly': {
      const dow = (new Date(`${asOf}T00:00:00Z`).getUTCDay() + 6) % 7;
      const from = addDays(asOf, -dow);
      return { from, to: addDays(from, 6) };
    }
    case 'monthly':
    default: {
      const startDay = Math.min(Math.max(1, budget.startDay || 1), 28);
      if (startDay === 1) return monthRange(asOf);
      const day = Number(asOf.slice(8, 10));
      const anchor = day >= startDay ? asOf : addMonths(asOf, -1);
      const from = `${anchor.slice(0, 7)}-${String(startDay).padStart(2, '0')}`;
      return { from, to: addDays(addMonths(from, 1), -1) };
    }
  }
}

/** Which category ids a budget covers, including children of a chosen parent. */
function budgetCovers(budget: Budget, accounts: AccountMap): (id: ID) => boolean {
  return (id: ID) => {
    const acc = accounts.get(id);
    if (acc?.class !== 'expense_category') return false;
    if (budget.categoryIds.length === 0) return true;
    if (budget.categoryIds.includes(id)) return true;
    return acc.parentId != null && budget.categoryIds.includes(acc.parentId);
  };
}

function spentInRange(
  budget: Budget,
  txns: readonly Transaction[],
  accounts: AccountMap,
  range: DateRange,
): number {
  const covers = budgetCovers(budget, accounts);
  let spent = 0;
  for (const t of inRange(live(txns), range)) {
    for (const p of t.postings) {
      if (covers(p.accountId)) spent += p.baseAmount;
    }
  }
  return spent;
}

/** The period immediately before this one, for the same budget. */
function previousPeriod(budget: Budget, range: DateRange): DateRange {
  return budgetRange(budget, addDays(range.from, -1));
}

/**
 * Unspent budget carried in from earlier periods.
 *
 * Walks forward from the budget's creation so each period's leftover feeds the
 * next, which is what "carry unspent forward" actually means. Overspend carries
 * too, as a negative — hiding it would let a budget quietly reset itself every
 * month.
 */
export function budgetCarry(
  budget: Budget,
  txns: readonly Transaction[],
  accounts: AccountMap,
  range: DateRange,
  maxPeriods = 24,
): number {
  if (!budget.rollover || budget.period === 'custom') return 0;

  const bornOn = budget.createdAt.slice(0, 10);
  const periods: DateRange[] = [];
  let cursor = previousPeriod(budget, range);
  for (let i = 0; i < maxPeriods && cursor.to >= bornOn; i++) {
    periods.unshift(cursor);
    const next = previousPeriod(budget, cursor);
    if (next.from >= cursor.from) break; // guard against a non-advancing period
    cursor = next;
  }

  let carry = 0;
  for (const period of periods) {
    carry = budget.limit + carry - spentInRange(budget, txns, accounts, period);
  }
  return carry;
}

export function budgetStatus(
  budget: Budget,
  txns: readonly Transaction[],
  accounts: AccountMap,
  asOf: CalendarDate = today(),
): BudgetStatus {
  const range = budgetRange(budget, asOf);
  const spent = spentInRange(budget, txns, accounts, range);

  // A rollover budget spends against its limit plus whatever was left over.
  const carry = budgetCarry(budget, txns, accounts, range);
  const limit = budget.limit + carry;

  const daysTotal = rangeLengthDays(range);
  const elapsed = Math.min(daysTotal, Math.max(0, daysElapsed(range, asOf)));
  const remainingDays = daysRemaining(range, asOf);
  const remaining = limit - spent;
  const used = limit > 0 ? spent / limit : 0;
  const projected = elapsed > 0 ? Math.round((spent / elapsed) * daysTotal) : spent;

  const projectionReliable =
    elapsed >= MIN_DAYS_FOR_PROJECTION && elapsed / daysTotal >= MIN_SHARE_FOR_PROJECTION;

  let health: BudgetHealth = 'on_track';
  if (spent > limit) health = 'over';
  else if (projectionReliable && projected > limit && remainingDays > 0) health = 'projected_over';
  else if (used >= (budget.warnAt || 0.8)) health = 'warning';

  return {
    budget,
    range,
    limit,
    carry,
    spent,
    remaining,
    used,
    daysTotal,
    daysElapsed: elapsed,
    daysRemaining: remainingDays,
    projected,
    projectionReliable,
    safeDailyRemaining: remainingDays > 0 ? Math.max(0, Math.round(remaining / remainingDays)) : 0,
    health,
  };
}

// ---------------------------------------------------------------------------
// Account-level views
// ---------------------------------------------------------------------------

export interface LedgerRow {
  txn: Transaction;
  /** Effect on this account, in the account's own currency. */
  delta: number;
  /** Balance after this transaction. */
  runningBalance: number;
}

/** Transaction history for one account, newest first, with a running balance. */
export function accountLedger(
  txns: readonly Transaction[],
  accountId: ID,
): LedgerRow[] {
  const rows = live(txns)
    .map((txn) => ({
      txn,
      delta: sumMinor(txn.postings.filter((p) => p.accountId === accountId).map((p) => p.amount)),
    }))
    .filter((r) => r.delta !== 0 || r.txn.postings.some((p) => p.accountId === accountId))
    .sort((a, b) =>
      a.txn.date === b.txn.date
        ? (a.txn.time ?? '').localeCompare(b.txn.time ?? '') || a.txn.createdAt.localeCompare(b.txn.createdAt)
        : a.txn.date.localeCompare(b.txn.date),
    );

  let running = 0;
  const withBalance = rows.map((r) => {
    running += r.delta;
    return { ...r, runningBalance: running };
  });
  return withBalance.reverse();
}

/** Available credit on a card: limit minus what is owed. */
export function availableCredit(account: Account, balances: Balances): number | null {
  if (account.class !== 'credit_card' || account.creditLimit == null) return null;
  return account.creditLimit + balanceOf(balances, account.id);
}

// ---------------------------------------------------------------------------
// Grouping helpers for lists
// ---------------------------------------------------------------------------

export function groupByDate(txns: readonly Transaction[]): Array<{ date: CalendarDate; txns: Transaction[] }> {
  const map = new Map<CalendarDate, Transaction[]>();
  for (const t of txns) {
    const arr = map.get(t.date);
    if (arr) arr.push(t);
    else map.set(t.date, [t]);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({
      date,
      txns: list.sort(
        (a, b) => (b.time ?? '').localeCompare(a.time ?? '') || b.createdAt.localeCompare(a.createdAt),
      ),
    }));
}

export const LIQUID = LIQUID_CLASSES;
