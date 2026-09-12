import { describe, it, expect } from 'vitest';
import { makeLedger, rs, makeAccount } from '../test/fixtures';
import {
  buildSpend,
  buildEarn,
  buildMove,
  buildOpening,
  buildRefund,
  voidTransaction,
  type Result,
} from './ledger';
import {
  computeBalances,
  balanceOf,
  balanceAsOf,
  computeNetWorth,
  netWorthAsOf,
  netWorthSeries,
  summarisePeriod,
  currentMonthSummary,
  categoryBreakdown,
  rollUpToParents,
  monthlyTrend,
  dailySpendSeries,
  merchantSpending,
  largestExpenses,
  budgetStatus,
  budgetRange,
  budgetCarry,
  accountLedger,
  availableCredit,
  groupByDate,
  live,
} from './projections';
import { computeSafeToSpend, assessHealth } from './safeToSpend';
import { buildOccurrences } from './recurrence';
import { monthRange } from './dates';
import type { Budget, Goal, Recurrence, Transaction } from './types';

const M = (r: Result<Transaction>): Transaction => {
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join('; '));
  return r.value;
};

/** A month of realistic activity: salary, rent, groceries, a transfer, a card. */
function scenario() {
  const { a, ctx, accounts } = makeLedger();
  const txns: Transaction[] = [
    M(buildOpening({ date: '2026-08-31', accountId: a.bank.id, amount: rs(150000), openingAccountId: a.opening.id }, ctx)),
    M(buildOpening({ date: '2026-08-31', accountId: a.cash.id, amount: rs(10000), openingAccountId: a.opening.id }, ctx)),
    M(buildEarn({ date: '2026-09-01', accountId: a.bank.id, allocations: [{ categoryId: a.salary.id, amount: rs(200000) }] }, ctx)),
    M(buildSpend({ date: '2026-09-02', accountId: a.bank.id, merchant: 'Imtiaz', allocations: [{ categoryId: a.groceries.id, amount: rs(12000) }] }, ctx)),
    M(buildSpend({ date: '2026-09-03', accountId: a.cash.id, merchant: 'OPTP', allocations: [{ categoryId: a.food.id, amount: rs(850) }] }, ctx)),
    M(buildSpend({ date: '2026-09-05', accountId: a.card.id, merchant: 'Imtiaz', allocations: [{ categoryId: a.groceries.id, amount: rs(5000) }] }, ctx)),
    M(buildMove({ kind: 'transfer', date: '2026-09-06', fromAccountId: a.bank.id, toAccountId: a.cash.id, amount: rs(20000) }, ctx)),
    M(buildMove({ kind: 'cc_payment', date: '2026-09-07', fromAccountId: a.bank.id, toAccountId: a.card.id, amount: rs(5000) }, ctx)),
  ];
  return { a, ctx, accounts, txns };
}

describe('balances are derived, never stored', () => {
  it('sums postings into per-account balances', () => {
    const { a, txns } = scenario();
    const b = computeBalances(txns);
    // 150,000 opening + 200,000 salary − 12,000 groceries − 20,000 transfer − 5,000 card payment
    expect(balanceOf(b, a.bank.id)).toBe(rs(313000));
    // 10,000 opening − 850 food + 20,000 transfer
    expect(balanceOf(b, a.cash.id)).toBe(rs(29150));
    // −5,000 spend + 5,000 payment
    expect(balanceOf(b, a.card.id)).toBe(0);
  });

  it('excludes voided transactions from every figure', () => {
    const { a, txns, accounts } = scenario();
    const withVoid = txns.map((t, i) => (i === 3 ? voidTransaction(t, '2026-09-10T00:00:00Z') : t));
    const b = computeBalances(withVoid);
    expect(balanceOf(b, a.bank.id)).toBe(rs(325000)); // the 12,000 is back

    const summary = summarisePeriod(withVoid, accounts, monthRange('2026-09-15'), '2026-09-30');
    expect(summary.expenses).toBe(rs(5850)); // 850 + 5,000, not 17,850

    // ...but the row is still there, retrievable.
    expect(withVoid).toHaveLength(txns.length);
    expect(live(withVoid)).toHaveLength(txns.length - 1);
  });

  it('computes a balance as at a past date', () => {
    const { a, txns } = scenario();
    expect(balanceAsOf(txns, a.bank.id, '2026-08-31')).toBe(rs(150000));
    expect(balanceAsOf(txns, a.bank.id, '2026-09-01')).toBe(rs(350000));
    expect(balanceAsOf(txns, a.bank.id, '2026-09-02')).toBe(rs(338000));
  });

  it('allows a negative balance rather than clamping it', () => {
    const { a, ctx } = makeLedger();
    const txns = [
      M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(5000) }] }, ctx)),
    ];
    expect(balanceOf(computeBalances(txns), a.cash.id)).toBe(rs(-5000));
  });
});

describe('net worth', () => {
  it('nets assets against liabilities and ignores categories', () => {
    const { ctx, txns, accounts } = scenario();
    const nw = computeNetWorth(computeBalances(txns), accounts);
    // bank 313,000 + cash 29,150 + card 0
    expect(nw.assets).toBe(rs(342150));
    expect(nw.liabilities).toBe(0);
    expect(nw.net).toBe(rs(342150));
    void ctx;
  });

  it('reports a card balance as a positive liability figure', () => {
    const { a, ctx, accounts } = makeLedger();
    const txns = [
      M(buildOpening({ date: '2026-09-01', accountId: a.bank.id, amount: rs(100000), openingAccountId: a.opening.id }, ctx)),
      M(buildSpend({ date: '2026-09-02', accountId: a.card.id, allocations: [{ categoryId: a.groceries.id, amount: rs(30000) }] }, ctx)),
    ];
    const nw = computeNetWorth(computeBalances(txns), accounts);
    expect(nw.assets).toBe(rs(100000));
    expect(nw.liabilities).toBe(rs(30000)); // shown positive
    expect(nw.net).toBe(rs(70000));
  });

  it('leaves net worth unchanged when money is only lent', () => {
    const { a, ctx, accounts } = makeLedger();
    const before = [M(buildOpening({ date: '2026-09-01', accountId: a.cash.id, amount: rs(50000), openingAccountId: a.opening.id }, ctx))];
    const after = [...before, M(buildMove({ kind: 'lend', date: '2026-09-02', fromAccountId: a.cash.id, toAccountId: a.sara.id, amount: rs(4000) }, ctx))];

    expect(computeNetWorth(computeBalances(before), accounts).net)
      .toBe(computeNetWorth(computeBalances(after), accounts).net);
  });

  it('reports net worth as at a past date', () => {
    const { txns, accounts } = scenario();
    expect(netWorthAsOf(txns, accounts, '2026-08-31').net).toBe(rs(160000));
    expect(netWorthAsOf(txns, accounts, '2026-09-01').net).toBe(rs(360000));
  });

  it('builds a month-end series', () => {
    const { txns, accounts } = scenario();
    const series = netWorthSeries(txns, accounts, 3, '2026-09-30');
    expect(series).toHaveLength(3);
    expect(series[0].date).toBe('2026-07-31');
    expect(series[2].date).toBe('2026-09-30');
    expect(series[0].net).toBe(0); // nothing had happened yet
    expect(series[2].net).toBe(rs(342150));
  });

  it('honours an account excluded from net worth', () => {
    const { ctx, accounts, a } = makeLedger();
    const excluded = makeAccount('investment', 'Pension', { id: 'acc_pension', excludeFromNetWorth: true });
    accounts.set(excluded.id, excluded);
    const txns = [
      M(buildOpening({ date: '2026-09-01', accountId: excluded.id, amount: rs(500000), openingAccountId: a.opening.id }, ctx)),
    ];
    expect(computeNetWorth(computeBalances(txns), accounts).net).toBe(0);
  });
});

describe('period summary', () => {
  it('counts income and expenses but not transfers or card payments', () => {
    const { txns, accounts } = scenario();
    const s = summarisePeriod(txns, accounts, monthRange('2026-09-15'), '2026-09-30');

    expect(s.income).toBe(rs(200000));
    expect(s.expenses).toBe(rs(17850)); // 12,000 + 850 + 5,000
    expect(s.savings).toBe(rs(182150));
    expect(s.savingsRate).toBeCloseTo(0.910_75, 5);
  });

  it('excludes the opening balance from income', () => {
    const { txns, accounts } = scenario();
    const august = summarisePeriod(txns, accounts, monthRange('2026-08-15'), '2026-08-31');
    expect(august.income).toBe(0);
    expect(august.expenses).toBe(0);
  });

  it('reports a null savings rate when there is no income', () => {
    const { a, ctx, accounts } = makeLedger();
    const txns = [M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(500) }] }, ctx))];
    expect(summarisePeriod(txns, accounts, monthRange('2026-09-15'), '2026-09-30').savingsRate).toBeNull();
  });

  it('reports a negative savings rate when overspending', () => {
    const { a, ctx, accounts } = makeLedger();
    const txns = [
      M(buildEarn({ date: '2026-09-01', accountId: a.bank.id, allocations: [{ categoryId: a.salary.id, amount: rs(10000) }] }, ctx)),
      M(buildSpend({ date: '2026-09-02', accountId: a.bank.id, allocations: [{ categoryId: a.food.id, amount: rs(15000) }] }, ctx)),
    ];
    const s = summarisePeriod(txns, accounts, monthRange('2026-09-15'), '2026-09-30');
    expect(s.savings).toBe(rs(-5000));
    expect(s.savingsRate).toBeCloseTo(-0.5, 5);
  });

  it('nets refunds out of expenses', () => {
    const { a, ctx, accounts } = makeLedger();
    const buy = M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(3000) }] }, ctx));
    const ref = M(buildRefund({ date: '2026-09-04', originalTxnId: buy.id, toAccountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(800) }] }, ctx));
    expect(summarisePeriod([buy, ref], accounts, monthRange('2026-09-15'), '2026-09-30').expenses).toBe(rs(2200));
  });

  it('averages daily spend over elapsed days only', () => {
    const { txns, accounts } = scenario();
    const s = summarisePeriod(txns, accounts, monthRange('2026-09-15'), '2026-09-10');
    expect(s.averageDailySpend).toBe(Math.round(rs(17850) / 10));
  });

  it('exposes a current-month convenience view', () => {
    const { txns, accounts } = scenario();
    expect(currentMonthSummary(txns, accounts, '2026-09-30').expenses).toBe(rs(17850));
  });
});

describe('category breakdown', () => {
  it('ranks categories by spend with shares that sum to one', () => {
    const { a, txns, accounts } = scenario();
    const slices = categoryBreakdown(txns, accounts, monthRange('2026-09-15'));

    expect(slices[0].accountId).toBe(a.groceries.id);
    expect(slices[0].amount).toBe(rs(17000)); // 12,000 + 5,000
    expect(slices[1].accountId).toBe(a.food.id);
    expect(slices[1].amount).toBe(rs(850));
    expect(slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
  });

  it('rolls subcategories into their parents', () => {
    const { a, ctx, accounts } = makeLedger();
    const dining = makeAccount('expense_category', 'Dining out', { id: 'cat_dining', parentId: a.food.id });
    const takeaway = makeAccount('expense_category', 'Takeaway', { id: 'cat_takeaway', parentId: a.food.id });
    accounts.set(dining.id, dining);
    accounts.set(takeaway.id, takeaway);

    const txns = [
      M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: dining.id, amount: rs(2000) }] }, ctx)),
      M(buildSpend({ date: '2026-09-02', accountId: a.cash.id, allocations: [{ categoryId: takeaway.id, amount: rs(1000) }] }, ctx)),
      M(buildSpend({ date: '2026-09-03', accountId: a.cash.id, allocations: [{ categoryId: a.transport.id, amount: rs(500) }] }, ctx)),
    ];

    const rolled = rollUpToParents(categoryBreakdown(txns, accounts, monthRange('2026-09-15')), accounts);
    expect(rolled[0].name).toBe('Food');
    expect(rolled[0].amount).toBe(rs(3000));
    expect(rolled[1].name).toBe('Transport');
  });

  it('breaks down income too', () => {
    const { a, txns, accounts } = scenario();
    const slices = categoryBreakdown(txns, accounts, monthRange('2026-09-15'), 'income_category');
    expect(slices).toHaveLength(1);
    expect(slices[0].accountId).toBe(a.salary.id);
    expect(slices[0].amount).toBe(rs(200000)); // positive, not negative
  });

  it('returns an empty list for a period with no activity', () => {
    const { txns, accounts } = scenario();
    expect(categoryBreakdown(txns, accounts, monthRange('2026-05-15'))).toEqual([]);
  });
});

describe('trends and rankings', () => {
  it('builds a monthly income/expense trend', () => {
    const { txns, accounts } = scenario();
    const trend = monthlyTrend(txns, accounts, 3, '2026-09-30');
    expect(trend).toHaveLength(3);
    expect(trend[2].income).toBe(rs(200000));
    expect(trend[2].expenses).toBe(rs(17850));
    expect(trend[0].expenses).toBe(0);
  });

  it('produces one point per day, including zero days', () => {
    const { txns, accounts } = scenario();
    const series = dailySpendSeries(txns, accounts, monthRange('2026-09-15'));
    expect(series).toHaveLength(30);
    expect(series.find((p) => p.date === '2026-09-02')!.amount).toBe(rs(12000));
    expect(series.find((p) => p.date === '2026-09-04')!.amount).toBe(0);
  });

  it('aggregates spending by merchant', () => {
    const { txns, accounts } = scenario();
    const merchants = merchantSpending(txns, accounts, monthRange('2026-09-15'));
    expect(merchants[0].merchant).toBe('Imtiaz');
    expect(merchants[0].amount).toBe(rs(17000));
    expect(merchants[0].txnCount).toBe(2);
    expect(merchants[0].lastDate).toBe('2026-09-05');
  });

  it('ranks the largest expenses', () => {
    const { txns, accounts } = scenario();
    const top = largestExpenses(txns, accounts, monthRange('2026-09-15'), 2);
    expect(top).toHaveLength(2);
    expect(top[0].amount).toBe(rs(12000));
    expect(top[1].amount).toBe(rs(5000));
  });
});

describe('budgets', () => {
  const budget = (over: Partial<Budget> = {}): Budget => ({
    id: 'bud_1',
    name: 'Groceries',
    categoryIds: ['cat_groceries'],
    limit: rs(20000),
    period: 'monthly',
    customFrom: null,
    customTo: null,
    startDay: 1,
    rollover: false,
    warnAt: 0.8,
    archived: false,
    color: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...over,
  });

  it('measures spend, remaining, and pace', () => {
    const { txns, accounts } = scenario();
    const s = budgetStatus(budget(), txns, accounts, '2026-09-10');

    expect(s.spent).toBe(rs(17000));
    expect(s.remaining).toBe(rs(3000));
    expect(s.used).toBeCloseTo(0.85, 5);
    expect(s.daysTotal).toBe(30);
    expect(s.daysElapsed).toBe(10);
    expect(s.daysRemaining).toBe(20);
    expect(s.projected).toBe(rs(51000)); // 17,000 / 10 days × 30
  });

  it('flags budgets that are over, trending over, or merely warm', () => {
    const { txns, accounts } = scenario();
    expect(budgetStatus(budget({ limit: rs(10000) }), txns, accounts, '2026-09-10').health).toBe('over');
    expect(budgetStatus(budget({ limit: rs(20000) }), txns, accounts, '2026-09-10').health).toBe('projected_over');
    expect(budgetStatus(budget({ limit: rs(60000) }), txns, accounts, '2026-09-10').health).toBe('on_track');
    // Late in the period, a high usage is a warning rather than a projection.
    expect(budgetStatus(budget({ limit: rs(18000) }), txns, accounts, '2026-09-30').health).toBe('warning');
  });

  it('refuses to project from too little of the period', () => {
    const { txns, accounts } = scenario();
    // Day 2 of a 30-day month: one big shop would "project" to 15x the budget.
    const early = budgetStatus(budget({ limit: rs(20000) }), txns, accounts, '2026-09-02');
    expect(early.projectionReliable).toBe(false);
    expect(early.health).not.toBe('projected_over');

    // By day 10 there is enough of a pace to say something.
    const later = budgetStatus(budget({ limit: rs(20000) }), txns, accounts, '2026-09-10');
    expect(later.projectionReliable).toBe(true);
    expect(later.health).toBe('projected_over');
  });

  it('still reports genuine overspending on day one', () => {
    const { txns, accounts } = scenario();
    // An unreliable projection must never suppress a real, already-breached limit.
    const over = budgetStatus(budget({ limit: rs(5000) }), txns, accounts, '2026-09-02');
    expect(over.projectionReliable).toBe(false);
    expect(over.health).toBe('over');
  });

  it('covers all expense categories when none are named', () => {
    const { txns, accounts } = scenario();
    expect(budgetStatus(budget({ categoryIds: [] }), txns, accounts, '2026-09-10').spent).toBe(rs(17850));
  });

  it('includes subcategories of a budgeted parent', () => {
    const { a, ctx, accounts } = makeLedger();
    const dining = makeAccount('expense_category', 'Dining out', { id: 'cat_dining', parentId: a.food.id });
    accounts.set(dining.id, dining);
    const txns = [M(buildSpend({ date: '2026-09-02', accountId: a.cash.id, allocations: [{ categoryId: dining.id, amount: rs(2500) }] }, ctx))];
    expect(budgetStatus(budget({ categoryIds: [a.food.id] }), txns, accounts, '2026-09-10').spent).toBe(rs(2500));
  });

  it('carries unspent budget forward when rollover is on', () => {
    const { a, ctx, accounts } = makeLedger();
    // Budget of 20,000/month. July spends 5,000, August spends 8,000.
    const txns = [
      M(buildSpend({ date: '2026-07-10', accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(5000) }] }, ctx)),
      M(buildSpend({ date: '2026-08-10', accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(8000) }] }, ctx)),
    ];
    const rolling = budget({ rollover: true, createdAt: '2026-07-01T00:00:00Z' });

    // September starts with July's 15,000 and August's 12,000 left over.
    const status = budgetStatus(rolling, txns, accounts, '2026-09-10');
    expect(status.carry).toBe(rs(27000));
    expect(status.limit).toBe(rs(47000)); // 20,000 + 27,000
    expect(status.remaining).toBe(rs(47000)); // nothing spent yet in September
  });

  it('carries an overspend forward as a negative, rather than resetting', () => {
    const { a, ctx, accounts } = makeLedger();
    // August blows through the 20,000 limit by 5,000.
    const txns = [
      M(buildSpend({ date: '2026-08-10', accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(25000) }] }, ctx)),
    ];
    const rolling = budget({ rollover: true, createdAt: '2026-08-01T00:00:00Z' });

    const status = budgetStatus(rolling, txns, accounts, '2026-09-10');
    expect(status.carry).toBe(rs(-5000));
    expect(status.limit).toBe(rs(15000));
  });

  it('ignores periods before the budget existed', () => {
    const { a, ctx, accounts } = makeLedger();
    const txns = [
      M(buildSpend({ date: '2026-01-10', accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(1000) }] }, ctx)),
    ];
    // Created in September, so nothing from January counts towards the carry.
    const rolling = budget({ rollover: true, createdAt: '2026-09-01T00:00:00Z' });
    expect(budgetCarry(rolling, txns, accounts, budgetRange(rolling, '2026-09-10'))).toBe(0);
  });

  it('carries nothing when rollover is off', () => {
    const { a, ctx, accounts } = makeLedger();
    const txns = [
      M(buildSpend({ date: '2026-08-10', accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(1000) }] }, ctx)),
    ];
    const status = budgetStatus(budget({ rollover: false, createdAt: '2026-07-01T00:00:00Z' }), txns, accounts, '2026-09-10');
    expect(status.carry).toBe(0);
    expect(status.limit).toBe(rs(20000));
  });

  it('supports a salary-aligned month starting on the 25th', () => {
    const r = budgetRange(budget({ startDay: 25 }), '2026-09-10');
    expect(r).toEqual({ from: '2026-08-25', to: '2026-09-24' });
    expect(budgetRange(budget({ startDay: 25 }), '2026-09-26')).toEqual({ from: '2026-09-25', to: '2026-10-24' });
  });

  it('supports custom, weekly and yearly periods', () => {
    expect(budgetRange(budget({ period: 'custom', customFrom: '2026-09-05', customTo: '2026-09-19' }), '2026-09-10'))
      .toEqual({ from: '2026-09-05', to: '2026-09-19' });
    expect(budgetRange(budget({ period: 'yearly' }), '2026-09-10')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(budgetRange(budget({ period: 'weekly' }), '2026-09-10')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('handles a zero limit without dividing by zero', () => {
    const { txns, accounts } = scenario();
    const s = budgetStatus(budget({ limit: 0 }), txns, accounts, '2026-09-10');
    expect(Number.isFinite(s.used)).toBe(true);
    expect(s.health).toBe('over');
  });
});

describe('account views', () => {
  it('lists an account history newest-first with a running balance', () => {
    const { a, txns } = scenario();
    const rows = accountLedger(txns, a.cash.id);

    expect(rows).toHaveLength(3);
    expect(rows[0].txn.date).toBe('2026-09-06'); // newest first
    expect(rows[0].runningBalance).toBe(rs(29150));
    expect(rows[2].runningBalance).toBe(rs(10000)); // oldest: the opening balance
  });

  it('computes available credit on a card', () => {
    const { a, ctx, accounts } = makeLedger();
    const txns = [M(buildSpend({ date: '2026-09-01', accountId: a.card.id, allocations: [{ categoryId: a.groceries.id, amount: rs(30000) }] }, ctx))];
    const b = computeBalances(txns);
    expect(availableCredit(a.card, b)).toBe(rs(270000)); // 300,000 limit − 30,000
    expect(availableCredit(a.bank, b)).toBeNull();
    void accounts;
  });

  it('groups transactions by date, newest day first', () => {
    const { txns } = scenario();
    const groups = groupByDate(live(txns));
    expect(groups[0].date).toBe('2026-09-07');
    expect(groups[groups.length - 1].date).toBe('2026-08-31');
  });
});

describe('safe to spend', () => {
  const goal = (over: Partial<Goal> = {}): Goal => ({
    id: 'gol_laptop',
    name: 'Laptop',
    targetAmount: rs(300000),
    targetDate: '2027-06-30',
    accountId: 'acc_goal_laptop',
    currency: 'PKR',
    icon: null,
    color: null,
    notes: null,
    plannedContribution: rs(25000),
    plannedFrequency: 'monthly',
    archived: false,
    completedAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...over,
  });

  const rent: Recurrence = {
    id: 'rec_rent', name: 'Rent', kind: 'expense', amount: rs(60000), currency: 'PKR',
    accountId: 'acc_bank', categoryId: 'cat_housing', toAccountId: null, merchant: null,
    notes: null, tags: [], frequency: 'monthly', interval: 1, byWeekday: null, byMonthDay: 10,
    startDate: '2026-01-10', endDate: null, maxOccurrences: null, leadDays: 7, autoPost: false,
    archived: false, isBill: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };

  it('derives a number that equals the sum of its own explanation', () => {
    const { a, txns, accounts } = scenario();
    const occurrences = buildOccurrences({
      recurrences: [rent], overrides: [],
      range: { from: '2026-09-01', to: '2026-10-31' }, asOf: '2026-09-08',
    });

    const result = computeSafeToSpend({
      accounts: [...accounts.values()],
      balances: computeBalances(txns),
      occurrences,
      goals: [goal()],
      txns,
      horizonDays: 30,
      reserveGoals: true,
      asOf: '2026-09-08',
    });

    // The headline must always equal the visible breakdown — that is the promise.
    expect(result.amount).toBe(result.lines.reduce((s, l) => s + l.amount, 0));

    const byKey = Object.fromEntries(result.lines.map((l) => [l.key, l.amount]));
    expect(byKey.liquid).toBe(rs(342150)); // bank + cash, excluding the goal
    // 30 days from 8 Sep reaches 8 Oct, so only the 10 Sep rent is inside the
    // horizon — the 10 Oct one is two days beyond it.
    expect(byKey.bills).toBe(rs(-60000));
    expect(byKey.goals).toBe(rs(-25000)); // planned contribution not yet made
    expect(byKey.cards).toBeUndefined(); // card is paid off
    expect(result.amount).toBe(rs(257150));
    void a;
  });

  it('deducts an unpaid card balance so a rupee is not spent twice', () => {
    const { a, ctx, accounts } = makeLedger();
    const txns = [
      M(buildOpening({ date: '2026-09-01', accountId: a.bank.id, amount: rs(100000), openingAccountId: a.opening.id }, ctx)),
      M(buildSpend({ date: '2026-09-02', accountId: a.card.id, allocations: [{ categoryId: a.groceries.id, amount: rs(15000) }] }, ctx)),
    ];
    const result = computeSafeToSpend({
      accounts: [...accounts.values()], balances: computeBalances(txns),
      occurrences: [], goals: [], txns, horizonDays: 30, reserveGoals: false, asOf: '2026-09-08',
    });
    expect(result.amount).toBe(rs(85000));
    expect(result.lines.find((l) => l.key === 'cards')!.amount).toBe(rs(-15000));
  });

  it('stops reserving a goal once the month contribution has been made', () => {
    const { a, ctx, accounts } = makeLedger();
    const txns = [
      M(buildOpening({ date: '2026-09-01', accountId: a.bank.id, amount: rs(100000), openingAccountId: a.opening.id }, ctx)),
      M(buildMove({ kind: 'goal_contribution', date: '2026-09-03', fromAccountId: a.bank.id, toAccountId: a.goal.id, amount: rs(25000) }, ctx)),
    ];
    const result = computeSafeToSpend({
      accounts: [...accounts.values()], balances: computeBalances(txns),
      occurrences: [], goals: [goal()], txns, horizonDays: 30, reserveGoals: true, asOf: '2026-09-08',
    });
    expect(result.lines.find((l) => l.key === 'goals')).toBeUndefined();
    expect(result.amount).toBe(rs(75000)); // the goal money has already left the bank
  });

  it('reports a shortfall rather than clamping at zero', () => {
    const { a, ctx, accounts } = makeLedger();
    const txns = [M(buildOpening({ date: '2026-09-01', accountId: a.bank.id, amount: rs(10000), openingAccountId: a.opening.id }, ctx))];
    const occurrences = buildOccurrences({
      recurrences: [rent], overrides: [], range: { from: '2026-09-01', to: '2026-09-30' }, asOf: '2026-09-08',
    });
    const result = computeSafeToSpend({
      accounts: [...accounts.values()], balances: computeBalances(txns),
      occurrences, goals: [], txns, horizonDays: 30, reserveGoals: false, asOf: '2026-09-08',
    });
    expect(result.amount).toBe(rs(-50000));
    expect(result.shortfall).toBe(true);
    void a;
  });

  it('gives every line a human explanation', () => {
    const { txns, accounts } = scenario();
    const result = computeSafeToSpend({
      accounts: [...accounts.values()], balances: computeBalances(txns),
      occurrences: [], goals: [], txns, horizonDays: 30, reserveGoals: false, asOf: '2026-09-08',
    });
    for (const line of result.lines) {
      expect(line.label.length).toBeGreaterThan(0);
      expect(line.detail.length).toBeGreaterThan(10);
    }
  });
});

describe('financial health', () => {
  it('reads as strong when nothing is wrong', () => {
    const h = assessHealth({
      savingsRate: 0.35, netWorth: rs(500000), safeToSpend: rs(80000),
      overdueBills: 0, budgetsOver: 0, budgetsProjectedOver: 0, monthsOfExpensesCovered: 6,
    });
    expect(h.level).toBe('strong');
  });

  it('escalates as problems accumulate', () => {
    expect(assessHealth({
      savingsRate: 0.1, netWorth: 0, safeToSpend: rs(1000),
      overdueBills: 0, budgetsOver: 0, budgetsProjectedOver: 1, monthsOfExpensesCovered: 2,
    }).level).toBe('steady');

    expect(assessHealth({
      savingsRate: 0.1, netWorth: 0, safeToSpend: rs(1000),
      overdueBills: 2, budgetsOver: 0, budgetsProjectedOver: 0, monthsOfExpensesCovered: 2,
    }).level).toBe('tight');

    expect(assessHealth({
      savingsRate: -0.2, netWorth: 0, safeToSpend: rs(-5000),
      overdueBills: 3, budgetsOver: 2, budgetsProjectedOver: 0, monthsOfExpensesCovered: 0.4,
    }).level).toBe('strained');
  });

  it('omits the savings signal when there was no income', () => {
    const h = assessHealth({
      savingsRate: null, netWorth: 0, safeToSpend: 0,
      overdueBills: 0, budgetsOver: 0, budgetsProjectedOver: 0, monthsOfExpensesCovered: null,
    });
    expect(h.signals.find((s) => s.key === 'savings_rate')).toBeUndefined();
  });
});
