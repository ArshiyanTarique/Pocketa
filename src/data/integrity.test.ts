/**
 * The constraints IndexedDB cannot enforce.
 *
 * Each test breaks one rule that a relational database would have refused, and
 * checks that the breakage is caught — and, where it is safe to, mended without
 * inventing anything.
 */

import { describe, it, expect } from 'vitest';
import { checkIntegrity, repairDataset, summariseIssues, type Dataset } from './integrity';
import type { Account, Transaction, Posting } from '../core/types';

const now = '2026-09-01T00:00:00.000Z';

function account(id: string, over: Partial<Account> = {}): Account {
  return {
    id,
    class: 'cash',
    name: id,
    parentId: null,
    currency: 'PKR',
    icon: null,
    color: null,
    archived: false,
    archivedAt: null,
    system: false,
    sortOrder: 0,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function posting(accountId: string, amount: number): Posting {
  return { id: `p_${accountId}_${amount}`, accountId, amount, currency: 'PKR', baseAmount: amount, fxRate: 1, memo: null };
}

function txn(id: string, postings: Posting[], over: Partial<Transaction> = {}): Transaction {
  return {
    id,
    kind: 'expense',
    date: '2026-09-01',
    time: null,
    postings,
    merchant: null,
    notes: null,
    tags: [],
    attachmentIds: [],
    linkedTxnId: null,
    recurrenceId: null,
    occurrenceKey: null,
    importBatchId: null,
    dedupeHash: null,
    voided: false,
    voidedAt: null,
    currency: 'PKR',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    accounts: [account('cash'), account('groceries', { class: 'expense_category' })],
    transactions: [],
    budgets: [],
    recurrences: [],
    overrides: [],
    goals: [],
    debts: [],
    people: [],
    imports: [],
    carpools: [],
    carpoolRiders: [],
    carpoolTrips: [],
    carpoolSettlements: [],
    ops: [],
    settings: [
      {
        id: 'settings',
        baseCurrency: 'PKR',
        fxRates: {},
        fxUpdatedAt: null,
        theme: 'system',
        accentColor: 'blue',
        avatarUrl: null,
        weekStartsOn: 1,
        monthStartDay: 1,
        safeToSpendHorizon: 30,
        safeToSpendReserveGoals: true,
        hideAmounts: false,
        onboarded: true,
        deviceId: 'dev',
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...over,
  };
}

const codes = (d: Dataset) => checkIntegrity(d).issues.map((i) => i.code);

describe('a clean dataset', () => {
  it('passes', () => {
    const report = checkIntegrity(
      dataset({ transactions: [txn('t1', [posting('cash', -5000), posting('groceries', 5000)])] }),
    );
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.counts.transactions).toBe(1);
  });
});

describe('the zero-sum invariant', () => {
  it('catches a transaction whose sides do not cancel', () => {
    const d = dataset({ transactions: [txn('t1', [posting('cash', -5000), posting('groceries', 4000)])] });
    expect(codes(d)).toContain('not_balanced');
    expect(checkIntegrity(d).ok).toBe(false);
  });

  it('catches one that balances in its own currency but not in the base', () => {
    const bad = txn('t1', [
      { ...posting('cash', -5000), baseAmount: -5000 },
      { ...posting('groceries', 5000), baseAmount: 4900 },
    ]);
    expect(codes(dataset({ transactions: [bad] }))).toContain('not_balanced');
  });

  it('catches an amount that is not a whole number of paisa', () => {
    const d = dataset({ transactions: [txn('t1', [posting('cash', -50.5), posting('groceries', 50.5)])] });
    expect(codes(d)).toContain('bad_amount');
  });

  it('catches an impossible exchange rate', () => {
    const bad = txn('t1', [
      { ...posting('cash', -5000), fxRate: 0 },
      posting('groceries', 5000),
    ]);
    expect(codes(dataset({ transactions: [bad] }))).toContain('bad_fx_rate');
  });
});

describe('foreign keys', () => {
  it('catches a posting pointing at an account that is not there', () => {
    const d = dataset({ transactions: [txn('t1', [posting('cash', -5000), posting('ghost', 5000)])] });
    const report = checkIntegrity(d);
    expect(report.issues.map((i) => i.code)).toContain('orphan_posting');
    // Fatal, because dropping the side would unbalance the transaction and
    // inventing an account would be a guess about someone's money.
    expect(report.ok).toBe(false);
  });

  it('catches a refund pointing at an original that is gone, and mends it', () => {
    const d = dataset({
      transactions: [txn('t1', [posting('cash', -5000), posting('groceries', 5000)], { linkedTxnId: 'gone' })],
    });
    expect(codes(d)).toContain('orphan_link');
    expect(checkIntegrity(d).ok).toBe(true); // repairable, not fatal

    const { data, repaired } = repairDataset(d);
    expect(repaired).toBe(1);
    expect(data.transactions[0].linkedTxnId).toBeNull();
    expect(checkIntegrity(data).issues).toEqual([]);
  });

  it('catches a budget covering a category that no longer exists, and drops it', () => {
    const d = dataset({
      budgets: [
        {
          id: 'b1',
          name: 'Food',
          categoryIds: ['groceries', 'deleted'],
          limit: 100000,
          period: 'monthly',
          customFrom: null,
          customTo: null,
          startDay: 1,
          rollover: false, rolloverMode: 'restart', rolloverAccountId: null,
          warnAt: 0.8,
          archived: false,
          color: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    expect(codes(d)).toContain('orphan_category');

    const { data } = repairDataset(d);
    expect(data.budgets[0].categoryIds).toEqual(['groceries']);
  });

  it('catches a budget pointing at something that is not a category', () => {
    const d = dataset({
      budgets: [
        {
          id: 'b1',
          name: 'Odd',
          categoryIds: ['cash'],
          limit: 1000,
          period: 'monthly',
          customFrom: null,
          customTo: null,
          startDay: 1,
          rollover: false, rolloverMode: 'restart', rolloverAccountId: null,
          warnAt: 0.8,
          archived: false,
          color: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    expect(codes(d)).toContain('not_a_category');
  });

  it('catches a receipt attached to a transaction that is not here', () => {
    const d = dataset({
      attachments: [
        { id: 'a1', txnId: 'gone', name: 'r.png', mimeType: 'image/png', size: 10, blob: null, thumbnail: null, createdAt: now },
      ],
    });
    expect(codes(d)).toContain('orphan_txn');
    const { data } = repairDataset(d);
    expect(data.attachments![0].txnId).toBeNull();
  });
});

describe('structural rules', () => {
  it('catches a category that is its own ancestor', () => {
    const a = account('a', { class: 'expense_category', parentId: 'b' });
    const b = account('b', { class: 'expense_category', parentId: 'a' });
    const report = checkIntegrity(dataset({ accounts: [a, b] }));
    expect(report.issues.map((i) => i.code)).toContain('parent_cycle');
    expect(report.ok).toBe(false);
  });

  it('catches two rows sharing an id', () => {
    const d = dataset({ accounts: [account('cash'), account('cash'), account('groceries', { class: 'expense_category' })] });
    const report = checkIntegrity(d);
    expect(report.issues.map((i) => i.code)).toContain('duplicate_id');
    expect(report.ok).toBe(false);
  });

  it('catches the same bill occurrence recorded twice, and keeps the newer', () => {
    const base = {
      recurrenceId: 'r1',
      dueDate: '2026-09-01',
      status: 'paid' as const,
      amount: null,
      paidDate: null,
      txnId: null,
      notes: null,
      createdAt: now,
    };
    const d = dataset({
      recurrences: [
        {
          id: 'r1',
          name: 'Rent',
          kind: 'expense',
          amount: 100000,
          currency: 'PKR',
          accountId: 'cash',
          categoryId: 'groceries',
          toAccountId: null,
          merchant: null,
          notes: null,
          tags: [],
          frequency: 'monthly',
          interval: 1,
          byWeekday: null,
          byMonthDay: 1,
          startDate: '2026-01-01',
          endDate: null,
          maxOccurrences: null,
          leadDays: 3,
          autoPost: false,
          archived: false,
          isBill: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      overrides: [
        { ...base, id: 'o1', updatedAt: '2026-09-01T00:00:00.000Z' },
        { ...base, id: 'o2', status: 'skipped', updatedAt: '2026-09-02T00:00:00.000Z' },
      ],
    });
    expect(codes(d)).toContain('duplicate_occurrence');

    const { data } = repairDataset(d);
    expect(data.overrides).toHaveLength(1);
    expect(data.overrides[0].id).toBe('o2');
  });

  it('catches an override belonging to a bill that is gone, and drops it', () => {
    const d = dataset({
      overrides: [
        {
          id: 'o1',
          recurrenceId: 'missing',
          dueDate: '2026-09-01',
          status: 'paid',
          amount: null,
          paidDate: null,
          txnId: null,
          notes: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    expect(codes(d)).toContain('orphan_recurrence');
    expect(repairDataset(d).data.overrides).toHaveLength(0);
  });

  it('insists on exactly one settings row', () => {
    expect(codes(dataset({ settings: [] }))).toContain('settings_count');
  });

  it('catches a carpool billing whose total does not match its lines', () => {
    const d = dataset({
      carpools: [
        {
          id: 'c1',
          name: 'Uni',
          ratePerTrip: 15000,
          currency: 'PKR',
          settleAs: 'recovery',
          settleCategoryId: null,
          notes: null,
          archived: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      carpoolSettlements: [
        {
          id: 's1',
          carpoolId: 'c1',
          from: '2026-09-01',
          to: '2026-09-30',
          lines: [{ riderId: 'r1', personId: 'p1', personName: 'Sara', trips: 2, amount: 30000, txnId: null }],
          total: 45000,
          tripCount: 2,
          createdAt: now,
        },
      ],
    });
    const report = checkIntegrity(d);
    expect(report.issues.map((i) => i.code)).toContain('total_mismatch');
    expect(report.ok).toBe(false);
  });

  it('refuses to quietly un-bill a trip whose settlement is missing', () => {
    const d = dataset({
      carpools: [
        {
          id: 'c1',
          name: 'Uni',
          ratePerTrip: 15000,
          currency: 'PKR',
          settleAs: 'recovery',
          settleCategoryId: null,
          notes: null,
          archived: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      carpoolTrips: [
        {
          id: 't1',
          carpoolId: 'c1',
          date: '2026-09-01',
          riderIds: [],
          rates: {},
          note: null,
          settlementId: 'gone',
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const report = checkIntegrity(d);
    // Clearing the stamp would make an already-billed trip billable again, so
    // this is reported rather than repaired.
    expect(report.issues.map((i) => i.code)).toContain('orphan_settlement');
    expect(report.ok).toBe(false);
    expect(repairDataset(d).data.carpoolTrips[0].settlementId).toBe('gone');
  });
});

describe('repair', () => {
  it('never invents anything, and never touches a figure', () => {
    const d = dataset({
      transactions: [txn('t1', [posting('cash', -5000), posting('groceries', 5000)], { linkedTxnId: 'gone' })],
      accounts: [account('cash', { parentId: 'gone' }), account('groceries', { class: 'expense_category' })],
    });
    const { data } = repairDataset(d);

    expect(data.accounts).toHaveLength(2);
    expect(data.accounts[0].parentId).toBeNull();
    expect(data.transactions[0].postings.map((p) => p.amount)).toEqual([-5000, 5000]);
  });

  it('leaves a clean dataset exactly as it was', () => {
    const d = dataset({ transactions: [txn('t1', [posting('cash', -5000), posting('groceries', 5000)])] });
    const { data, repaired } = repairDataset(d);
    expect(repaired).toBe(0);
    expect(data.transactions).toEqual(d.transactions);
    expect(data.accounts).toEqual(d.accounts);
  });
});

describe('reporting', () => {
  it('collapses repeated problems into one line with a count', () => {
    const d = dataset({
      transactions: [
        txn('t1', [posting('cash', -1000), posting('groceries', 1000)], { linkedTxnId: 'gone' }),
        txn('t2', [posting('cash', -2000), posting('groceries', 2000)], { linkedTxnId: 'gone' }),
      ],
    });
    const lines = summariseIssues(checkIntegrity(d));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/2 times/);
  });
});
