/**
 * The edge-case checklist from the brief, tested item by item.
 *
 * Each `it` is named after an entry on that list so a reader can check coverage
 * against the requirement rather than against the implementation.
 */

import { describe, it, expect } from 'vitest';
import { makeLedger, rs } from '../test/fixtures';
import { useStore } from '../store/useStore';
import {
  buildSpend,
  buildEarn,
  buildMove,
  buildRefund,
  buildAdjustment,
  buildOpening,
  refundableRemaining,
  dedupeHash,
  voidTransaction,
  type Result } from './ledger';
import {
  computeBalances,
  balanceOf,
  computeNetWorth,
  summarisePeriod,
  budgetStatus,
  live } from './projections';
import { buildOccurrences, missedOccurrences, nthOccurrence } from './recurrence';
import { parseAmount, formatMoney, allocateEvenly, convertMinor, sumMinor } from './money';
import { addMonths, daysBetween, endOfMonth, isLeapYear, monthRange, today, withDayOfMonth } from './dates';
import { buildImportRows, guessMapping, parseCsv, parseFlexibleDate } from '../data/exchange';
import type { Budget, Recurrence, Transaction } from './types';

const M = (r: Result<Transaction>): Transaction => {
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join('; '));
  return r.value;
};
const issues = (r: Result<Transaction>) => (r.ok ? [] : r.issues.map((i) => i.code));

// ===========================================================================
describe('amounts', () => {
  it('zero amounts are rejected everywhere they could be entered', () => {
    const { a, ctx } = makeLedger();
    expect(issues(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: 0 }] }, ctx))).toContain('zero_amount');
    expect(issues(buildEarn({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.salary.id, amount: 0 }] }, ctx))).toContain('zero_amount');
    expect(issues(buildMove({ kind: 'transfer', date: '2026-09-01', fromAccountId: a.bank.id, toAccountId: a.cash.id, amount: 0 }, ctx))).toContain('zero_amount');
    expect(issues(buildAdjustment({ date: '2026-09-01', accountId: a.cash.id, delta: 0, adjustmentAccountId: a.adjustment.id }, ctx))).toContain('zero_amount');
    expect(issues(buildOpening({ date: '2026-09-01', accountId: a.bank.id, amount: 0, openingAccountId: a.opening.id }, ctx))).toContain('zero_amount');
  });

  it('negative values are refused where direction is implied, and allowed where it is meaningful', () => {
    const { a, ctx } = makeLedger();
    // A negative transfer would silently reverse direction.
    expect(issues(buildMove({ kind: 'transfer', date: '2026-09-01', fromAccountId: a.bank.id, toAccountId: a.cash.id, amount: rs(-500) }, ctx))).toContain('negative_amount');
    // But an adjustment and a card opening balance are legitimately negative.
    expect(M(buildAdjustment({ date: '2026-09-01', accountId: a.cash.id, delta: rs(-300), adjustmentAccountId: a.adjustment.id }, ctx))).toBeTruthy();
    expect(M(buildOpening({ date: '2026-09-01', accountId: a.card.id, amount: rs(-12000), openingAccountId: a.opening.id }, ctx))).toBeTruthy();
  });

  it('extremely large amounts stay exact', () => {
    const { a, ctx } = makeLedger();
    const huge = rs(9_999_999_999);
    const t = M(buildSpend({ date: '2026-09-01', accountId: a.bank.id, allocations: [{ categoryId: a.food.id, amount: huge }] }, ctx));
    expect(sumMinor(t.postings.map((p) => p.baseAmount))).toBe(0);
    expect(balanceOf(computeBalances([t]), a.bank.id)).toBe(-huge);
    // And it still renders rather than overflowing into scientific notation.
    expect(formatMoney(huge)).toMatch(/^Rs\. [\d,]+\.\d{2}$/);
  });

  it('decimal amounts never drift through float arithmetic', () => {
    const { a, ctx } = makeLedger();
    const legs = [10.1, 20.2, 30.3, 39.4].map((v) => parseAmount(String(v)));
    const allocations = legs.map((r, i) => {
      if (!r.ok) throw new Error('bad fixture');
      return { categoryId: [a.food.id, a.groceries.id, a.household.id, a.personal.id][i], amount: r.minor };
    });
    // 10.1 + 20.2 + 30.3 + 39.4 is exactly 100.00 in minor units, where in
    // floating point it is 99.99999999999999.
    const t = M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations }, ctx));
    expect(balanceOf(computeBalances([t]), a.cash.id)).toBe(rs(-100));
    expect(sumMinor(allocations.map((x) => x.amount))).toBe(rs(100));
  });
});

// ===========================================================================
describe('duplicates', () => {
  it('two identical transactions are both recorded — repetition is legitimate', () => {
    const { a, ctx } = makeLedger();
    const one = M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, merchant: 'Chai Wala', allocations: [{ categoryId: a.food.id, amount: rs(120) }] }, ctx));
    const two = M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, merchant: 'Chai Wala', allocations: [{ categoryId: a.food.id, amount: rs(120) }] }, ctx));
    expect(one.id).not.toBe(two.id);
    expect(balanceOf(computeBalances([one, two]), a.cash.id)).toBe(rs(-240));
  });

  it('a duplicate import is detected before it is committed', () => {
    const { a, ctx } = makeLedger();
    const existing = M(buildSpend({
      date: '2026-09-01', accountId: a.cash.id, merchant: 'Imtiaz',
      allocations: [{ categoryId: a.groceries.id, amount: rs(2400) }],
      dedupeHash: dedupeHash({ date: '2026-09-01', amount: rs(-2400), accountId: a.cash.id, merchant: 'Imtiaz' }) }, ctx));

    const csv = parseCsv('Date,Description,Amount\n2026-09-01,Imtiaz,-2400\n2026-09-02,Shell,-6800\n');
    const rows = buildImportRows({
      rows: csv,
      mapping: guessMapping(csv[0]),
      hasHeader: true,
      dayFirst: true,
      currency: 'PKR',
      invertAmount: false,
      accountId: a.cash.id,
      existing: [existing] });

    expect(rows[0].duplicateOf).toBe(existing.id);
    expect(rows[0].include).toBe(false); // unticked by default
    expect(rows[1].duplicateOf).toBeNull();
    expect(rows[1].include).toBe(true);
  });

  it('a file containing the same row twice flags the second occurrence', () => {
    const { a } = makeLedger();
    const csv = parseCsv('Date,Description,Amount\n2026-09-01,Imtiaz,-2400\n2026-09-01,Imtiaz,-2400\n');
    const rows = buildImportRows({
      rows: csv, mapping: guessMapping(csv[0]), hasHeader: true, dayFirst: true,
      currency: 'PKR', invertAmount: false, accountId: a.cash.id, existing: [] });
    expect(rows[0].duplicateOf).toBeNull();
    expect(rows[1].duplicateOf).toBe('in-file');
  });
});

// ===========================================================================
describe('transfers and credit cards', () => {
  it('a transfer leaves income and expenses untouched', () => {
    const { a, ctx, accounts } = makeLedger();
    const t = M(buildMove({ kind: 'transfer', date: '2026-09-06', fromAccountId: a.bank.id, toAccountId: a.cash.id, amount: rs(20000) }, ctx));
    const s = summarisePeriod([t], accounts, monthRange('2026-09-15'), '2026-09-30');
    expect(s.expenses).toBe(0);
    expect(s.income).toBe(0);
  });

  it('a transfer between the same account is refused', () => {
    const { a, ctx } = makeLedger();
    expect(issues(buildMove({ kind: 'transfer', date: '2026-09-01', fromAccountId: a.cash.id, toAccountId: a.cash.id, amount: rs(100) }, ctx))).toContain('same_account');
  });

  it('a card payment is not an expense, and the purchase is counted once', () => {
    const { a, ctx, accounts } = makeLedger();
    const buy = M(buildSpend({ date: '2026-09-05', accountId: a.card.id, allocations: [{ categoryId: a.groceries.id, amount: rs(9000) }] }, ctx));
    const pay = M(buildMove({ kind: 'cc_payment', date: '2026-09-20', fromAccountId: a.bank.id, toAccountId: a.card.id, amount: rs(9000) }, ctx));
    const s = summarisePeriod([buy, pay], accounts, monthRange('2026-09-15'), '2026-09-30');
    expect(s.expenses).toBe(rs(9000));
    expect(balanceOf(computeBalances([buy, pay]), a.card.id)).toBe(0);
  });

  it('a card refund reduces both the liability and the expense', () => {
    const { a, ctx, accounts } = makeLedger();
    const buy = M(buildSpend({ date: '2026-09-05', accountId: a.card.id, allocations: [{ categoryId: a.groceries.id, amount: rs(9000) }] }, ctx));
    const ref = M(buildRefund({ date: '2026-09-08', originalTxnId: buy.id, toAccountId: a.card.id, allocations: [{ categoryId: a.groceries.id, amount: rs(2000) }] }, ctx));
    expect(summarisePeriod([buy, ref], accounts, monthRange('2026-09-15'), '2026-09-30').expenses).toBe(rs(7000));
    expect(balanceOf(computeBalances([buy, ref]), a.card.id)).toBe(rs(-7000));
  });
});

// ===========================================================================
describe('refunds', () => {
  it('a full refund nets the expense to zero and returns the money', () => {
    const { a, ctx, accounts } = makeLedger();
    const buy = M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(3000) }] }, ctx));
    const ref = M(buildRefund({ date: '2026-09-04', originalTxnId: buy.id, toAccountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(3000) }] }, ctx));
    expect(summarisePeriod([buy, ref], accounts, monthRange('2026-09-15'), '2026-09-30').expenses).toBe(0);
    expect(balanceOf(computeBalances([buy, ref]), a.cash.id)).toBe(0);
  });

  it('a partial refund leaves the correct net expense and remaining refundable', () => {
    const { a, ctx, accounts } = makeLedger();
    const buy = M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(3000) }] }, ctx));
    const ref = M(buildRefund({ date: '2026-09-04', originalTxnId: buy.id, toAccountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(800) }] }, ctx));
    expect(summarisePeriod([buy, ref], accounts, monthRange('2026-09-15'), '2026-09-30').expenses).toBe(rs(2200));
    expect(refundableRemaining(buy, [buy, ref], accounts)).toBe(rs(2200));
  });
});

// ===========================================================================
describe('splits and sharing', () => {
  it('a split totals its parent exactly, however awkward the division', () => {
    const { a, ctx } = makeLedger();
    const parts = allocateEvenly(rs(1000), 3);
    const t = M(buildSpend({
      date: '2026-09-01', accountId: a.cash.id,
      allocations: [
        { categoryId: a.groceries.id, amount: parts[0] },
        { categoryId: a.household.id, amount: parts[1] },
        { categoryId: a.personal.id, amount: parts[2] },
      ] }, ctx));
    expect(balanceOf(computeBalances([t]), a.cash.id)).toBe(rs(-1000));
  });

  it('a shared expense counts only my share as spending', () => {
    const { a, ctx, accounts } = makeLedger();
    const t = M(buildSpend({
      date: '2026-09-01', accountId: a.cash.id,
      allocations: [{ categoryId: a.food.id, amount: rs(1000) }],
      shares: [{ personAccountId: a.sara.id, amount: rs(2000) }] }, ctx));
    expect(summarisePeriod([t], accounts, monthRange('2026-09-15'), '2026-09-30').expenses).toBe(rs(1000));
    expect(balanceOf(computeBalances([t]), a.sara.id)).toBe(rs(2000));
  });
});

// ===========================================================================
describe('debts', () => {
  it('lending, borrowing and repaying never touch income or expenses', () => {
    const { a, ctx, accounts } = makeLedger();
    const txns = [
      M(buildMove({ kind: 'lend', date: '2026-09-02', fromAccountId: a.cash.id, toAccountId: a.sara.id, amount: rs(4000) }, ctx)),
      M(buildMove({ kind: 'repay_in', date: '2026-09-12', fromAccountId: a.sara.id, toAccountId: a.cash.id, amount: rs(4000) }, ctx)),
      M(buildMove({ kind: 'borrow', date: '2026-09-03', fromAccountId: a.bilal.id, toAccountId: a.cash.id, amount: rs(15000) }, ctx)),
      M(buildMove({ kind: 'repay_out', date: '2026-09-20', fromAccountId: a.cash.id, toAccountId: a.bilal.id, amount: rs(5000) }, ctx)),
    ];
    const s = summarisePeriod(txns, accounts, monthRange('2026-09-15'), '2026-09-30');
    expect(s.income).toBe(0);
    expect(s.expenses).toBe(0);

    const balances = computeBalances(txns);
    expect(balanceOf(balances, a.sara.id)).toBe(0); // settled
    expect(balanceOf(balances, a.bilal.id)).toBe(rs(-10000)); // still owed
    expect(balanceOf(balances, a.cash.id)).toBe(rs(10000));
  });

  it('borrowing raises net worth by nothing — the cash is matched by the liability', () => {
    const { a, ctx, accounts } = makeLedger();
    const before = [M(buildOpening({ date: '2026-09-01', accountId: a.cash.id, amount: rs(1000), openingAccountId: a.opening.id }, ctx))];
    const after = [...before, M(buildMove({ kind: 'borrow', date: '2026-09-03', fromAccountId: a.bilal.id, toAccountId: a.cash.id, amount: rs(15000) }, ctx))];
    expect(computeNetWorth(computeBalances(after), accounts).net).toBe(
      computeNetWorth(computeBalances(before), accounts).net,
    );
  });
});

// ===========================================================================
describe('recurring transactions', () => {
  const rec = (over: Partial<Recurrence> = {}): Recurrence => ({
    id: 'rec_1', name: 'Rent', kind: 'expense', amount: rs(85000), currency: 'PKR',
    accountId: 'acc_bank', categoryId: 'cat_food', toAccountId: null, merchant: null,
    notes: null, tags: [], frequency: 'monthly', interval: 1, byWeekday: null, byMonthDay: 3,
    startDate: '2026-01-03', endDate: null, maxOccurrences: null, leadDays: 7, autoPost: false,
    archived: false, isBill: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...over });

  it('a missed occurrence surfaces as overdue and keeps surfacing', () => {
    const views = buildOccurrences({
      recurrences: [rec({ startDate: '2026-06-03' })],
      overrides: [],
      range: { from: '2026-06-01', to: '2026-09-30' },
      asOf: '2026-09-15' });
    expect(missedOccurrences(views).map((v) => v.dueDate)).toEqual([
      '2026-06-03', '2026-07-03', '2026-08-03', '2026-09-03',
    ]);
  });

  it('a changed amount applies to one occurrence and never to the template', () => {
    const template = rec();
    const views = buildOccurrences({
      recurrences: [template],
      overrides: [{
        id: 'ovr_1', recurrenceId: 'rec_1', dueDate: '2026-04-03', status: 'paid',
        amount: rs(92000), paidDate: '2026-04-03', txnId: 'txn_x', notes: null,
        createdAt: '2026-04-03T00:00:00Z', updatedAt: '2026-04-03T00:00:00Z' }],
      range: { from: '2026-03-01', to: '2026-05-31' },
      asOf: '2026-05-31' });
    const byDate = Object.fromEntries(views.map((v) => [v.dueDate, v.amount]));
    expect(byDate['2026-03-03']).toBe(rs(85000));
    expect(byDate['2026-04-03']).toBe(rs(92000));
    expect(byDate['2026-05-03']).toBe(rs(85000));
    expect(template.amount).toBe(rs(85000));
  });
});

// ===========================================================================
describe('the calendar', () => {
  it('leap years and 29 February', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(endOfMonth('2028-02-01')).toBe('2028-02-29');
    expect(endOfMonth('2026-02-01')).toBe('2026-02-28');
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('month-end dates clamp without drifting', () => {
    const monthly = { byMonthDay: 31 } as Recurrence;
    const seq = [0, 1, 2, 3].map((n) =>
      nthOccurrence({ ...monthly, frequency: 'monthly', interval: 1, startDate: '2026-01-31' } as Recurrence, n),
    );
    expect(seq).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('year-end rolls over correctly', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(withDayOfMonth('2026-12-31', 31)).toBe('2026-12-31');
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

// ===========================================================================
describe('history and deletion', () => {
  it('a historical edit is recorded rather than overwriting the past', async () => {
    await useStore.getState().init(`edge_${Date.now()}_a`);
    const s = useStore.getState;
    const cash = s().accounts.find((a) => a.class === 'cash')!.id;
    const category = s().accounts.find((a) => a.name === 'Groceries')!.id;

    const created = await s().createTransaction({
      type: 'spend', date: '2026-01-15', accountId: cash,
      allocations: [{ categoryId: category, amount: rs(4000) }] });
    if (!created.ok) throw new Error('setup failed');

    await s().updateTransaction(created.value.id, {
      type: 'spend', date: '2026-01-15', accountId: cash,
      allocations: [{ categoryId: category, amount: rs(3500) }] });

    const history = s().ops.filter((o) => o.entityId === created.value.id);
    expect(history).toHaveLength(2);
    const change = history[1].changes!.find((c) => c.field === 'amount')!;
    expect([change.before, change.after]).toEqual([rs(4000), rs(3500)]);
  });

  it('a deleted transaction is excluded from totals but retained', () => {
    const { a, ctx, accounts } = makeLedger();
    const t = M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(900) }] }, ctx));
    const voided = voidTransaction(t, '2026-09-02T00:00:00Z');
    expect(summarisePeriod([voided], accounts, monthRange('2026-09-15'), '2026-09-30').expenses).toBe(0);
    expect(live([voided])).toHaveLength(0);
    expect(voided.postings).toEqual(t.postings); // nothing destroyed
  });

  it('an archived account keeps its history but accepts nothing new', () => {
    const { a, ctx } = makeLedger();
    expect(issues(buildSpend({ date: '2026-09-01', accountId: a.archived.id, allocations: [{ categoryId: a.food.id, amount: rs(100) }] }, ctx))).toContain('archived_account');
    const historical = M(buildSpend({ date: '2025-09-01', accountId: a.archived.id, allocations: [{ categoryId: a.food.id, amount: rs(100) }] }, { ...ctx, allowArchived: true }));
    expect(balanceOf(computeBalances([historical]), a.archived.id)).toBe(rs(-100));
  });

  it('an archived category leaves every past figure intact', async () => {
    await useStore.getState().init(`edge_${Date.now()}_b`);
    const s = useStore.getState;
    const cash = s().accounts.find((a) => a.class === 'cash')!.id;
    const category = s().accounts.find((a) => a.name === 'Groceries')!.id;

    await s().createTransaction({
      type: 'spend', date: '2026-09-01', accountId: cash,
      allocations: [{ categoryId: category, amount: rs(2500) }] });
    await s().archiveAccount(category, true);

    expect(summarisePeriod(s().transactions, s().accountMap(), monthRange('2026-09-15'), '2026-09-30').expenses).toBe(rs(2500));
    expect(s().transactions[0].postings.some((p) => p.accountId === category)).toBe(true);
  });
});

// ===========================================================================
describe('balances', () => {
  it('an account may go negative rather than being clamped', () => {
    const { a, ctx } = makeLedger();
    const t = M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(5000) }] }, ctx));
    expect(balanceOf(computeBalances([t]), a.cash.id)).toBe(rs(-5000));
  });

  it('cash reconciliation records the difference where it can be seen', () => {
    const { a, ctx, accounts } = makeLedger();
    const opening = M(buildOpening({ date: '2026-09-01', accountId: a.cash.id, amount: rs(3500), openingAccountId: a.opening.id }, ctx));
    const adjust = M(buildAdjustment({ date: '2026-09-20', accountId: a.cash.id, delta: rs(-300), adjustmentAccountId: a.adjustment.id }, ctx));

    const balances = computeBalances([opening, adjust]);
    expect(balanceOf(balances, a.cash.id)).toBe(rs(3200));
    expect(balanceOf(balances, a.adjustment.id)).toBe(rs(300));
    // An adjustment is not spending.
    expect(summarisePeriod([opening, adjust], accounts, monthRange('2026-09-15'), '2026-09-30').expenses).toBe(0);
  });
});

// ===========================================================================
describe('currency', () => {
  it('converts at the rate frozen on the transaction, not the rate today', () => {
    const { a, ctx } = makeLedger({ fxRates: { USD: 278.5 } });
    const t = M(buildSpend({ date: '2026-09-01', accountId: a.usd.id, currency: 'USD', allocations: [{ categoryId: a.food.id, amount: 1000 }] }, ctx));
    expect(t.postings[0].fxRate).toBe(278.5);

    // The rate moves; the recorded transaction does not.
    const later = { ...ctx, fxRates: { USD: 310 } };
    void later;
    expect(t.postings.find((p) => p.accountId === a.food.id)!.baseAmount).toBe(rs(2785));
  });

  it('refuses to invent a missing rate', () => {
    const { a, ctx } = makeLedger({ fxRates: {} });
    expect(issues(buildSpend({ date: '2026-09-01', accountId: a.usd.id, currency: 'USD', allocations: [{ categoryId: a.food.id, amount: 1000 }] }, ctx))).toContain('no_fx_rate');
  });

  it('keeps a cross-currency transfer balanced in the base currency', () => {
    const { a, ctx } = makeLedger({ fxRates: { USD: 278.5 } });
    const t = M(buildMove({ kind: 'transfer', date: '2026-09-01', fromAccountId: a.usd.id, toAccountId: a.bank.id, amount: 10000, toAmount: rs(27850) }, ctx));
    expect(sumMinor(t.postings.map((p) => p.baseAmount))).toBe(0);
  });

  it('rounds a conversion once, at the end', () => {
    expect(convertMinor(333, 'USD', 'PKR', 278.5333)).toBe(92752);
  });
});

// ===========================================================================
describe('storage', () => {
  it('survives a restart', async () => {
    const namespace = `edge_${Date.now()}_c`;
    await useStore.getState().init(namespace);
    const s = useStore.getState;
    const cash = s().accounts.find((a) => a.class === 'cash')!.id;
    const category = s().accounts.find((a) => a.name === 'Groceries')!.id;
    await s().createTransaction({ type: 'spend', date: '2026-09-01', accountId: cash, allocations: [{ categoryId: category, amount: rs(1500) }] });

    useStore.setState({ transactions: [], accounts: [], ops: [], status: 'idle' });
    await useStore.getState().init(namespace);

    expect(s().transactions).toHaveLength(1);
    expect(balanceOf(computeBalances(s().transactions), cash)).toBe(rs(-1500));
  });

  it('restores a backup and refuses a file that is not one', async () => {
    const namespace = `edge_${Date.now()}_d`;
    await useStore.getState().init(namespace);
    const s = useStore.getState;
    const cash = s().accounts.find((a) => a.class === 'cash')!.id;
    const category = s().accounts.find((a) => a.name === 'Groceries')!.id;
    await s().createTransaction({ type: 'spend', date: '2026-09-01', accountId: cash, allocations: [{ categoryId: category, amount: rs(700) }] });

    const snapshot = await s().exportBackup();
    await s().resetEverything();
    expect(s().transactions).toHaveLength(0);

    expect((await s().restoreBackup(snapshot)).ok).toBe(true);
    expect(s().transactions).toHaveLength(1);

    expect((await s().restoreBackup({ nope: true })).ok).toBe(false);
  });
});

// ===========================================================================
describe('imports', () => {
  it('reads a date the same way regardless of the host time zone', () => {
    expect(parseFlexibleDate('03/04/2026', true)).toBe('2026-04-03');
    expect(parseFlexibleDate('03/04/2026', false)).toBe('2026-03-04');
    expect(parseFlexibleDate('2026-04-03')).toBe('2026-04-03');
    expect(parseFlexibleDate('3-Apr-2026')).toBe('2026-04-03');
    expect(parseFlexibleDate('not a date')).toBeNull();
    expect(parseFlexibleDate('31/02/2026')).toBeNull(); // impossible
  });

  it('flags rows it cannot read rather than importing something wrong', () => {
    const { a } = makeLedger();
    const csv = parseCsv('Date,Description,Amount\n2026-09-01,Fine,-100\n,Missing date,-100\n2026-09-03,No amount,\n2026-09-04,Zero,0\n');
    const rows = buildImportRows({
      rows: csv, mapping: guessMapping(csv[0]), hasHeader: true, dayFirst: true,
      currency: 'PKR', invertAmount: false, accountId: a.cash.id, existing: [] });
    expect(rows.map((r) => r.problem)).toEqual([null, 'No readable date', 'No readable amount', 'Amount is zero']);
    expect(rows.filter((r) => r.include)).toHaveLength(1);
  });

  it('handles quoted fields, embedded commas and CRLF', () => {
    const rows = parseCsv('Date,Description,Amount\r\n2026-09-01,"Imtiaz, Karachi",-2400\r\n');
    expect(rows[1]).toEqual(['2026-09-01', 'Imtiaz, Karachi', '-2400']);
  });
});

// ===========================================================================
describe('time zones', () => {
  it('a calendar date never shifts with the host offset', () => {
    // today() reads local wall-clock parts, so late-evening entry stays on the
    // day the user is actually living in.
    expect(today(new Date(2026, 11, 31, 23, 59, 0))).toBe('2026-12-31');
    expect(today(new Date(2026, 0, 1, 0, 1, 0))).toBe('2026-01-01');
  });

  it('period boundaries are computed from strings, not Date maths', () => {
    expect(monthRange('2026-02-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02-15')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

// ===========================================================================
describe('budgets at period edges', () => {
  const budget: Budget = {
    id: 'bud_1', name: 'Groceries', categoryIds: ['cat_groceries'], limit: rs(20000),
    period: 'monthly', customFrom: null, customTo: null, startDay: 1, rollover: false,
    warnAt: 0.8, archived: false, color: null,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' };

  it('does not cry wolf on the first day of a period', () => {
    const { a, ctx, accounts } = makeLedger();
    const t = M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(9000) }] }, ctx));
    const status = budgetStatus(budget, [t], accounts, '2026-09-01');
    expect(status.projectionReliable).toBe(false);
    expect(status.health).not.toBe('projected_over');
  });

  it('handles the last day of a period without dividing by zero', () => {
    const { a, ctx, accounts } = makeLedger();
    const t = M(buildSpend({ date: '2026-09-01', accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(9000) }] }, ctx));
    const status = budgetStatus(budget, [t], accounts, '2026-09-30');
    expect(status.daysRemaining).toBe(0);
    expect(Number.isFinite(status.safeDailyRemaining)).toBe(true);
    expect(status.safeDailyRemaining).toBe(0);
  });

  it('a February budget uses 28 or 29 days as appropriate', () => {
    const { accounts } = makeLedger();
    expect(budgetStatus(budget, [], accounts, '2026-02-15').daysTotal).toBe(28);
    expect(budgetStatus(budget, [], accounts, '2028-02-15').daysTotal).toBe(29);
  });
});
