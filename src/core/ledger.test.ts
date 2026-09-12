import { describe, it, expect } from 'vitest';
import { makeLedger, rs } from '../test/fixtures';
import { sumMinor } from './money';
import {
  buildSpend,
  buildEarn,
  buildMove,
  buildRefund,
  buildAdjustment,
  buildOpening,
  validateTransaction,
  effectOnAccount,
  expenseAmount,
  incomeAmount,
  refundableRemaining,
  voidTransaction,
  dedupeHash,
  normaliseTags,
  unwrap,
  type Result,
} from './ledger';
import type { Transaction } from './types';

const DATE = '2026-09-01';

function must(r: Result<Transaction>): Transaction {
  if (!r.ok) throw new Error(r.issues.map((i) => `${i.code}: ${i.message}`).join('; '));
  return r.value;
}
function issuesOf(r: Result<Transaction>): string[] {
  return r.ok ? [] : r.issues.map((i) => i.code);
}

/** The invariant, asserted directly. Every scenario below is checked against it. */
function expectBalanced(txn: Transaction) {
  expect(sumMinor(txn.postings.map((p) => p.baseAmount)), 'base currency must balance').toBe(0);
  const currencies = new Set(txn.postings.map((p) => p.currency));
  if (currencies.size === 1) {
    expect(sumMinor(txn.postings.map((p) => p.amount)), 'original currency must balance').toBe(0);
  }
}

// ===========================================================================
describe('the zero-sum invariant', () => {
  it('holds for every builder', () => {
    const { a, ctx } = makeLedger();
    const txns = [
      must(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(850) }] }, ctx)),
      must(buildEarn({ date: DATE, accountId: a.bank.id, allocations: [{ categoryId: a.salary.id, amount: rs(200000) }] }, ctx)),
      must(buildMove({ kind: 'transfer', date: DATE, fromAccountId: a.bank.id, toAccountId: a.cash.id, amount: rs(20000) }, ctx)),
      must(buildAdjustment({ date: DATE, accountId: a.cash.id, delta: rs(-300), adjustmentAccountId: a.adjustment.id }, ctx)),
      must(buildOpening({ date: DATE, accountId: a.bank.id, amount: rs(100000), openingAccountId: a.opening.id }, ctx)),
    ];
    for (const t of txns) expectBalanced(t);
  });

  it('rejects a hand-made transaction that does not balance', () => {
    const { a, ctx } = makeLedger();
    const good = must(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(850) }] }, ctx));
    const tampered: Transaction = {
      ...good,
      postings: good.postings.map((p, i) => (i === 0 ? { ...p, amount: p.amount + 1, baseAmount: p.baseAmount + 1 } : p)),
    };
    expect(issuesOf(validateTransaction(tampered, ctx))).toContain('unbalanced_base');
  });
});

// ===========================================================================
describe('§4 transfers are not expenses', () => {
  it('moves money without touching any category', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildMove({ kind: 'transfer', date: DATE, fromAccountId: a.bank.id, toAccountId: a.cash.id, amount: rs(20000) }, ctx));

    expect(effectOnAccount(t, a.bank.id)).toBe(rs(-20000));
    expect(effectOnAccount(t, a.cash.id)).toBe(rs(20000));
    expect(expenseAmount(t, ctx.accounts)).toBe(0);
    expect(incomeAmount(t, ctx.accounts)).toBe(0);
    expectBalanced(t);
  });

  it('refuses a transfer to the same account', () => {
    const { a, ctx } = makeLedger();
    const r = buildMove({ kind: 'transfer', date: DATE, fromAccountId: a.bank.id, toAccountId: a.bank.id, amount: rs(20000) }, ctx);
    expect(issuesOf(r)).toContain('same_account');
  });

  it('refuses a transfer into a category', () => {
    const { a, ctx } = makeLedger();
    const r = buildMove({ kind: 'transfer', date: DATE, fromAccountId: a.bank.id, toAccountId: a.food.id, amount: rs(100) }, ctx);
    expect(issuesOf(r)).toContain('movement_touches_category');
  });
});

// ===========================================================================
describe('§5 credit cards', () => {
  it('records a card purchase as an expense that grows the liability', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildSpend({ date: DATE, accountId: a.card.id, allocations: [{ categoryId: a.groceries.id, amount: rs(5000) }] }, ctx));

    expect(effectOnAccount(t, a.card.id)).toBe(rs(-5000)); // liability grows
    expect(expenseAmount(t, ctx.accounts)).toBe(rs(5000)); // counted once
    expectBalanced(t);
  });

  it('treats paying the card bill as a transfer, never as an expense', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildMove({ kind: 'cc_payment', date: DATE, fromAccountId: a.bank.id, toAccountId: a.card.id, amount: rs(5000) }, ctx));

    expect(effectOnAccount(t, a.bank.id)).toBe(rs(-5000));
    expect(effectOnAccount(t, a.card.id)).toBe(rs(5000)); // liability shrinks
    expect(expenseAmount(t, ctx.accounts)).toBe(0);
    expectBalanced(t);
  });

  it('never double-counts a purchase and its later bill payment', () => {
    const { a, ctx } = makeLedger();
    const buy = must(buildSpend({ date: DATE, accountId: a.card.id, allocations: [{ categoryId: a.groceries.id, amount: rs(5000) }] }, ctx));
    const pay = must(buildMove({ kind: 'cc_payment', date: '2026-09-20', fromAccountId: a.bank.id, toAccountId: a.card.id, amount: rs(5000) }, ctx));

    const totalExpense = expenseAmount(buy, ctx.accounts) + expenseAmount(pay, ctx.accounts);
    expect(totalExpense).toBe(rs(5000)); // not 10,000

    // And the card is back to zero.
    expect(effectOnAccount(buy, a.card.id) + effectOnAccount(pay, a.card.id)).toBe(0);
  });

  it('handles a refund onto the card, reducing both the liability and the expense', () => {
    const { a, ctx } = makeLedger();
    const buy = must(buildSpend({ date: DATE, accountId: a.card.id, allocations: [{ categoryId: a.groceries.id, amount: rs(5000) }] }, ctx));
    const refund = must(buildRefund({ date: '2026-09-05', originalTxnId: buy.id, toAccountId: a.card.id, allocations: [{ categoryId: a.groceries.id, amount: rs(800) }] }, ctx));

    expect(effectOnAccount(refund, a.card.id)).toBe(rs(800)); // liability shrinks
    expect(expenseAmount(buy, ctx.accounts) + expenseAmount(refund, ctx.accounts)).toBe(rs(4200));
    expectBalanced(refund);
  });
});

// ===========================================================================
describe('§12 split transactions', () => {
  it('splits a supermarket bill so the parts total the parent exactly', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildSpend({
      date: DATE,
      accountId: a.cash.id,
      merchant: 'Imtiaz',
      allocations: [
        { categoryId: a.groceries.id, amount: rs(3000) },
        { categoryId: a.household.id, amount: rs(1200) },
        { categoryId: a.personal.id, amount: rs(800) },
      ],
    }, ctx));

    expect(effectOnAccount(t, a.cash.id)).toBe(rs(-5000));
    expect(expenseAmount(t, ctx.accounts)).toBe(rs(5000));
    expect(effectOnAccount(t, a.groceries.id)).toBe(rs(3000));
    expect(effectOnAccount(t, a.household.id)).toBe(rs(1200));
    expect(effectOnAccount(t, a.personal.id)).toBe(rs(800));
    expectBalanced(t);
  });

  it('rejects a negative split leg', () => {
    const { a, ctx } = makeLedger();
    const r = buildSpend({
      date: DATE,
      accountId: a.cash.id,
      allocations: [
        { categoryId: a.groceries.id, amount: rs(6000) },
        { categoryId: a.household.id, amount: rs(-1000) },
      ],
    }, ctx);
    expect(issuesOf(r)).toContain('negative_split');
  });
});

// ===========================================================================
describe('§10 shared expenses', () => {
  it('counts only my share as spending, and the rest as money owed to me', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildSpend({
      date: DATE,
      accountId: a.cash.id,
      merchant: 'OPTP',
      allocations: [{ categoryId: a.food.id, amount: rs(1000) }],
      shares: [{ personAccountId: a.sara.id, amount: rs(2000) }],
    }, ctx));

    expect(effectOnAccount(t, a.cash.id)).toBe(rs(-3000)); // I paid the full bill
    expect(expenseAmount(t, ctx.accounts)).toBe(rs(1000)); // but only 1,000 is MY expense
    expect(effectOnAccount(t, a.sara.id)).toBe(rs(2000)); // Sara owes me 2,000
    expectBalanced(t);
  });

  it('settles a share as a movement, never as income', () => {
    const { a, ctx } = makeLedger();
    const repay = must(buildMove({ kind: 'repay_in', date: '2026-09-10', fromAccountId: a.sara.id, toAccountId: a.cash.id, amount: rs(2000) }, ctx));

    expect(incomeAmount(repay, ctx.accounts)).toBe(0);
    expect(effectOnAccount(repay, a.sara.id)).toBe(rs(-2000)); // receivable cleared
    expect(effectOnAccount(repay, a.cash.id)).toBe(rs(2000));
  });
});

// ===========================================================================
describe('§9 debts', () => {
  it('lending is not an expense — it changes the form of an asset', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildMove({ kind: 'lend', date: DATE, fromAccountId: a.cash.id, toAccountId: a.sara.id, amount: rs(4000) }, ctx));

    expect(expenseAmount(t, ctx.accounts)).toBe(0);
    expect(effectOnAccount(t, a.cash.id)).toBe(rs(-4000));
    expect(effectOnAccount(t, a.sara.id)).toBe(rs(4000));
    // Net worth is unchanged: -4000 cash + 4000 receivable
    expect(effectOnAccount(t, a.cash.id) + effectOnAccount(t, a.sara.id)).toBe(0);
  });

  it('being repaid is not income', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildMove({ kind: 'repay_in', date: DATE, fromAccountId: a.sara.id, toAccountId: a.cash.id, amount: rs(4000) }, ctx));
    expect(incomeAmount(t, ctx.accounts)).toBe(0);
    expect(expenseAmount(t, ctx.accounts)).toBe(0);
  });

  it('borrowing is not income, and repaying is not an expense', () => {
    const { a, ctx } = makeLedger();
    const borrow = must(buildMove({ kind: 'borrow', date: DATE, fromAccountId: a.bilal.id, toAccountId: a.cash.id, amount: rs(15000) }, ctx));
    expect(incomeAmount(borrow, ctx.accounts)).toBe(0);
    expect(effectOnAccount(borrow, a.cash.id)).toBe(rs(15000));
    expect(effectOnAccount(borrow, a.bilal.id)).toBe(rs(-15000)); // I now owe

    const repay = must(buildMove({ kind: 'repay_out', date: '2026-10-01', fromAccountId: a.cash.id, toAccountId: a.bilal.id, amount: rs(5000) }, ctx));
    expect(expenseAmount(repay, ctx.accounts)).toBe(0);
    expect(effectOnAccount(repay, a.bilal.id)).toBe(rs(5000)); // liability shrinks

    // After borrowing 15k and repaying 5k, I owe 10k.
    expect(effectOnAccount(borrow, a.bilal.id) + effectOnAccount(repay, a.bilal.id)).toBe(rs(-10000));
  });
});

// ===========================================================================
describe('§7 goals', () => {
  it('treats a goal contribution as a transfer, not an expense', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildMove({ kind: 'goal_contribution', date: DATE, fromAccountId: a.bank.id, toAccountId: a.goal.id, amount: rs(50000) }, ctx));
    expect(expenseAmount(t, ctx.accounts)).toBe(0);
    expect(effectOnAccount(t, a.goal.id)).toBe(rs(50000));
  });

  it('treats a goal withdrawal as a transfer, not income', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildMove({ kind: 'goal_withdrawal', date: DATE, fromAccountId: a.goal.id, toAccountId: a.bank.id, amount: rs(10000) }, ctx));
    expect(incomeAmount(t, ctx.accounts)).toBe(0);
    expect(effectOnAccount(t, a.goal.id)).toBe(rs(-10000));
  });
});

// ===========================================================================
describe('§11 refunds', () => {
  it('computes the correct net expense for a partial refund', () => {
    const { a, ctx } = makeLedger();
    const buy = must(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(3000) }] }, ctx));
    const ref = must(buildRefund({ date: '2026-09-03', originalTxnId: buy.id, toAccountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(800) }] }, ctx));

    expect(expenseAmount(buy, ctx.accounts) + expenseAmount(ref, ctx.accounts)).toBe(rs(2200));
    expect(ref.linkedTxnId).toBe(buy.id);
    expectBalanced(ref);
  });

  it('computes zero net expense for a full refund', () => {
    const { a, ctx } = makeLedger();
    const buy = must(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(3000) }] }, ctx));
    const ref = must(buildRefund({ date: '2026-09-03', originalTxnId: buy.id, toAccountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(3000) }] }, ctx));

    expect(expenseAmount(buy, ctx.accounts) + expenseAmount(ref, ctx.accounts)).toBe(0);
    expect(effectOnAccount(buy, a.cash.id) + effectOnAccount(ref, a.cash.id)).toBe(0);
  });

  it('tracks how much of an original is still refundable', () => {
    const { a, ctx } = makeLedger();
    const buy = must(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(3000) }] }, ctx));
    expect(refundableRemaining(buy, [buy], ctx.accounts)).toBe(rs(3000));

    const ref = must(buildRefund({ date: '2026-09-03', originalTxnId: buy.id, toAccountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(800) }] }, ctx));
    expect(refundableRemaining(buy, [buy, ref], ctx.accounts)).toBe(rs(2200));

    const ref2 = must(buildRefund({ date: '2026-09-04', originalTxnId: buy.id, toAccountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(2200) }] }, ctx));
    expect(refundableRemaining(buy, [buy, ref, ref2], ctx.accounts)).toBe(0);
  });

  it('does not count refunds against a voided original', () => {
    const { a, ctx } = makeLedger();
    const buy = must(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.groceries.id, amount: rs(3000) }] }, ctx));
    expect(refundableRemaining(voidTransaction(buy, '2026-09-02T00:00:00Z'), [buy], ctx.accounts)).toBe(0);
  });
});

// ===========================================================================
describe('adjustments and opening balances', () => {
  it('posts a cash reconciliation difference somewhere visible', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildAdjustment({ date: DATE, accountId: a.cash.id, delta: rs(-300), adjustmentAccountId: a.adjustment.id }, ctx));

    expect(effectOnAccount(t, a.cash.id)).toBe(rs(-300));
    expect(effectOnAccount(t, a.adjustment.id)).toBe(rs(300));
    expect(expenseAmount(t, ctx.accounts)).toBe(0); // an adjustment is not spending
    expectBalanced(t);
  });

  it('refuses a no-op reconciliation', () => {
    const { a, ctx } = makeLedger();
    expect(issuesOf(buildAdjustment({ date: DATE, accountId: a.cash.id, delta: 0, adjustmentAccountId: a.adjustment.id }, ctx))).toContain('zero_amount');
  });

  it('seeds an opening balance, including a negative one for a card', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildOpening({ date: DATE, accountId: a.card.id, amount: rs(-12000), openingAccountId: a.opening.id }, ctx));
    expect(effectOnAccount(t, a.card.id)).toBe(rs(-12000));
    expectBalanced(t);
  });
});

// ===========================================================================
describe('edge cases', () => {
  it('rejects zero amounts', () => {
    const { a, ctx } = makeLedger();
    expect(issuesOf(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: 0 }] }, ctx))).toContain('zero_amount');
    expect(issuesOf(buildMove({ kind: 'transfer', date: DATE, fromAccountId: a.bank.id, toAccountId: a.cash.id, amount: 0 }, ctx))).toContain('zero_amount');
  });

  it('rejects a negative transfer rather than silently reversing direction', () => {
    const { a, ctx } = makeLedger();
    expect(issuesOf(buildMove({ kind: 'transfer', date: DATE, fromAccountId: a.bank.id, toAccountId: a.cash.id, amount: rs(-100) }, ctx))).toContain('negative_amount');
  });

  it('handles extremely large amounts without losing precision', () => {
    const { a, ctx } = makeLedger();
    const huge = rs(999_999_999_99); // ~Rs. 100 billion
    const t = must(buildSpend({ date: DATE, accountId: a.bank.id, allocations: [{ categoryId: a.food.id, amount: huge }] }, ctx));
    expect(effectOnAccount(t, a.bank.id)).toBe(-huge);
    expectBalanced(t);
  });

  it('rejects non-integer and non-finite amounts', () => {
    const { a, ctx } = makeLedger();
    expect(issuesOf(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: 10.5 }] }, ctx))).toContain('bad_amount');
    expect(issuesOf(buildMove({ kind: 'transfer', date: DATE, fromAccountId: a.bank.id, toAccountId: a.cash.id, amount: Number.NaN }, ctx))).toContain('bad_amount');
    expect(issuesOf(buildMove({ kind: 'transfer', date: DATE, fromAccountId: a.bank.id, toAccountId: a.cash.id, amount: Number.POSITIVE_INFINITY }, ctx))).toContain('bad_amount');
  });

  it('rejects an invalid date', () => {
    const { a, ctx } = makeLedger();
    expect(issuesOf(buildSpend({ date: '2026-02-30', accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(100) }] }, ctx))).toContain('bad_date');
  });

  it('accepts 29 February in a leap year', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildSpend({ date: '2028-02-29', accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(100) }] }, ctx));
    expect(t.date).toBe('2028-02-29');
  });

  it('refuses new activity on an archived account but keeps its history readable', () => {
    const { a, ctx } = makeLedger();
    expect(issuesOf(buildSpend({ date: DATE, accountId: a.archived.id, allocations: [{ categoryId: a.food.id, amount: rs(100) }] }, ctx))).toContain('archived_account');

    // ...unless explicitly permitted, as during an import or a restore.
    const permissive = { ...ctx, allowArchived: true };
    const t = must(buildSpend({ date: DATE, accountId: a.archived.id, allocations: [{ categoryId: a.food.id, amount: rs(100) }] }, permissive));
    expectBalanced(t);
  });

  it('allows an account balance to go negative', () => {
    const { a, ctx } = makeLedger();
    // Nothing in the engine prevents overspending; an overdraft is a real state.
    const t = must(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(999999) }] }, ctx));
    expect(effectOnAccount(t, a.cash.id)).toBeLessThan(0);
  });

  it('rejects an unknown account or category', () => {
    const { a, ctx } = makeLedger();
    expect(issuesOf(buildSpend({ date: DATE, accountId: 'acc_nope', allocations: [{ categoryId: a.food.id, amount: rs(100) }] }, ctx))).toContain('unknown_account');
    expect(issuesOf(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: 'cat_nope', amount: rs(100) }] }, ctx))).toContain('unknown_category');
  });

  it('refuses to file an expense against an income category, and vice versa', () => {
    const { a, ctx } = makeLedger();
    expect(issuesOf(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.salary.id, amount: rs(100) }] }, ctx))).toContain('bad_category');
    expect(issuesOf(buildEarn({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(100) }] }, ctx))).toContain('bad_category');
  });

  it('refuses to pay from a category', () => {
    const { a, ctx } = makeLedger();
    expect(issuesOf(buildSpend({ date: DATE, accountId: a.food.id, allocations: [{ categoryId: a.groceries.id, amount: rs(100) }] }, ctx))).toContain('bad_account');
  });

  it('produces a stable duplicate fingerprint that ignores merchant noise', () => {
    const base = { date: DATE, amount: rs(850), accountId: 'acc_cash' };
    expect(dedupeHash({ ...base, merchant: 'OPTP' })).toBe(dedupeHash({ ...base, merchant: '  optp  ' }));
    expect(dedupeHash({ ...base, merchant: 'OPTP' })).not.toBe(dedupeHash({ ...base, amount: rs(851), merchant: 'OPTP' }));
  });

  it('normalises tags, stripping hashes and duplicates', () => {
    expect(normaliseTags(['#University', 'university', ' Travel ', '', '#'])).toEqual(['University', 'Travel']);
    expect(normaliseTags(['Family Trip'])).toEqual(['Family-Trip']);
  });

  it('voids without destroying, and restores', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildSpend({ date: DATE, accountId: a.cash.id, allocations: [{ categoryId: a.food.id, amount: rs(100) }] }, ctx));
    const v = voidTransaction(t, '2026-09-02T00:00:00Z');
    expect(v.voided).toBe(true);
    expect(v.postings).toEqual(t.postings); // history intact
  });
});

// ===========================================================================
describe('multi-currency', () => {
  it('records a USD expense with a frozen base-currency value', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildSpend({
      date: DATE,
      accountId: a.usd.id,
      currency: 'USD',
      allocations: [{ categoryId: a.food.id, amount: 1000 }], // $10.00
    }, ctx));

    expect(effectOnAccount(t, a.usd.id)).toBe(-1000); // still USD minor units
    expect(expenseAmount(t, ctx.accounts)).toBe(rs(2785)); // Rs. 2,785 at 278.50
    expect(t.postings[0].fxRate).toBe(278.5);
    expectBalanced(t);
  });

  it('keeps a converted split exactly balanced despite rounding', () => {
    const { a, ctx } = makeLedger();
    // $10.00 split three ways cannot convert evenly at 278.50.
    const t = must(buildSpend({
      date: DATE,
      accountId: a.usd.id,
      currency: 'USD',
      allocations: [
        { categoryId: a.food.id, amount: 333 },
        { categoryId: a.groceries.id, amount: 333 },
        { categoryId: a.household.id, amount: 334 },
      ],
    }, ctx));
    expectBalanced(t); // the important part: base amounts still sum to zero
    expect(expenseAmount(t, ctx.accounts)).toBe(rs(2785));
  });

  it('handles a cross-currency transfer with an explicit received amount', () => {
    const { a, ctx } = makeLedger();
    const t = must(buildMove({
      kind: 'transfer',
      date: DATE,
      fromAccountId: a.usd.id,
      toAccountId: a.bank.id,
      amount: 10000, // $100.00
      toAmount: rs(27850), // Rs. 27,850
    }, ctx));

    expect(effectOnAccount(t, a.usd.id)).toBe(-10000);
    expect(effectOnAccount(t, a.bank.id)).toBe(rs(27850));
    expectBalanced(t); // base amounts balance even though currencies differ
  });

  it('asks for the received amount when currencies differ', () => {
    const { a, ctx } = makeLedger();
    expect(issuesOf(buildMove({ kind: 'transfer', date: DATE, fromAccountId: a.usd.id, toAccountId: a.bank.id, amount: 10000 }, ctx))).toContain('fx_required');
  });

  it('refuses to guess a missing exchange rate', () => {
    const { a, ctx } = makeLedger();
    const noRates = { ...ctx, fxRates: {} };
    const r = buildSpend({ date: DATE, accountId: a.usd.id, currency: 'USD', allocations: [{ categoryId: a.food.id, amount: 1000 }] }, noRates);
    expect(issuesOf(r)).toContain('no_fx_rate');
  });
});

// ===========================================================================
describe('unwrap', () => {
  it('throws a readable error for a failed result', () => {
    const { a, ctx } = makeLedger();
    expect(() => unwrap(buildMove({ kind: 'transfer', date: DATE, fromAccountId: a.bank.id, toAccountId: a.bank.id, amount: rs(1) }, ctx)))
      .toThrow(/cannot move to where it already is/);
  });
});
