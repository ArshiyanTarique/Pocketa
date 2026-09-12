import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore';
import { getDb } from '../data/db';
import { rs } from '../test/fixtures';
import { computeBalances, balanceOf, summarisePeriod, live } from '../core/projections';
import { monthRange } from '../core/dates';
import { historyFor } from '../data/oplog';
import type { TxnDraft } from '../core/draft';
import type { ID } from '../core/types';

let ns = 0;
function freshNamespace() {
  return `test_${Date.now()}_${++ns}`;
}

const s = () => useStore.getState();

/** Ids of the seeded accounts we need in tests. */
function ids() {
  const accounts = s().accounts;
  const find = (cls: string, name: string): ID =>
    accounts.find((a) => a.class === cls && a.name === name)!.id;
  return {
    cash: find('cash', 'Cash'),
    groceries: find('expense_category', 'Groceries'),
    diningOut: find('expense_category', 'Dining out'),
    salary: find('income_category', 'Salary'),
    adjustment: 'sys_adjustment',
    opening: 'sys_opening',
  };
}

const expense = (accountId: ID, categoryId: ID, amount: number, date = '2026-09-01'): TxnDraft => ({
  type: 'spend',
  date,
  accountId,
  merchant: 'Imtiaz',
  allocations: [{ categoryId, amount }],
});

describe('store initialisation', () => {
  beforeEach(async () => {
    await useStore.getState().init(freshNamespace());
  });

  it('seeds system accounts, categories and settings on first run', () => {
    expect(s().status).toBe('ready');
    expect(s().settings.baseCurrency).toBe('PKR');

    const classes = s().accounts.map((a) => a.class);
    expect(classes).toContain('adjustment');
    expect(classes).toContain('opening_balance');
    expect(classes).toContain('expense_category');
    expect(classes).toContain('income_category');
    expect(classes).toContain('cash');
  });

  it('creates parent categories with subcategories beneath them', () => {
    const food = s().accounts.find((a) => a.name === 'Food & Drink')!;
    const children = s().accounts.filter((a) => a.parentId === food.id);
    expect(children.map((c) => c.name)).toContain('Groceries');
    expect(children.map((c) => c.name)).toContain('Dining out');
  });

  it('marks the two system accounts undeletable', () => {
    const system = s().accounts.filter((a) => a.system);
    expect(system).toHaveLength(2);
  });
});

describe('recording transactions', () => {
  beforeEach(async () => {
    await useStore.getState().init(freshNamespace());
  });

  it('writes a transaction and an op together', async () => {
    const { cash, groceries } = ids();
    const result = await s().createTransaction(expense(cash, groceries, rs(1200)));
    expect(result.ok).toBe(true);

    expect(s().transactions).toHaveLength(1);
    expect(balanceOf(computeBalances(s().transactions), cash)).toBe(rs(-1200));

    const ops = s().ops.filter((o) => o.type === 'txn.created');
    expect(ops).toHaveLength(1);
    expect(ops[0].summary).toContain('Imtiaz');
  });

  it('rejects an invalid transaction without writing anything', async () => {
    const { cash, groceries } = ids();
    const result = await s().createTransaction(expense(cash, groceries, 0));
    expect(result.ok).toBe(false);
    expect(s().transactions).toHaveLength(0);
    expect(s().ops.filter((o) => o.type === 'txn.created')).toHaveLength(0);
  });

  it('records income and keeps it out of expenses', async () => {
    const { cash, salary, groceries } = ids();
    await s().createTransaction({ type: 'earn', date: '2026-09-01', accountId: cash, allocations: [{ categoryId: salary, amount: rs(100000) }] });
    await s().createTransaction(expense(cash, groceries, rs(1200)));

    const summary = summarisePeriod(s().transactions, s().accountMap(), monthRange('2026-09-15'), '2026-09-30');
    expect(summary.income).toBe(rs(100000));
    expect(summary.expenses).toBe(rs(1200));
  });
});

describe('§18 audit history', () => {
  beforeEach(async () => {
    await useStore.getState().init(freshNamespace());
  });

  it('retains both values when an amount is edited', async () => {
    const { cash, groceries } = ids();
    const created = await s().createTransaction(expense(cash, groceries, rs(4000)));
    if (!created.ok) throw new Error('setup failed');
    const id = created.value.id;

    const updated = await s().updateTransaction(id, expense(cash, groceries, rs(3500)));
    expect(updated.ok).toBe(true);

    const history = historyFor(s().ops, id);
    expect(history.map((o) => o.type)).toEqual(['txn.created', 'txn.amended']);

    const amountChange = history[1].changes!.find((c) => c.field === 'amount')!;
    expect(amountChange.before).toBe(rs(4000));
    expect(amountChange.after).toBe(rs(3500));
    expect(amountChange.money).toBe(true);

    // The ledger now reflects the new figure.
    expect(balanceOf(computeBalances(s().transactions), cash)).toBe(rs(-3500));
    // And there is still exactly one transaction, not two.
    expect(s().transactions).toHaveLength(1);
  });

  it('records a category change in words the user recognises', async () => {
    const { cash, groceries, diningOut } = ids();
    const created = await s().createTransaction(expense(cash, groceries, rs(2000)));
    if (!created.ok) throw new Error('setup failed');

    await s().updateTransaction(created.value.id, expense(cash, diningOut, rs(2000)));
    const history = historyFor(s().ops, created.value.id);
    const change = history[1].changes!.find((c) => c.field === 'categoryId')!;
    expect(change.before).toBe('Groceries');
    expect(change.after).toBe('Dining out');
  });

  it('keeps a deleted transaction recoverable', async () => {
    const { cash, groceries } = ids();
    const created = await s().createTransaction(expense(cash, groceries, rs(900)));
    if (!created.ok) throw new Error('setup failed');
    const id = created.value.id;

    await s().voidTransaction(id);
    expect(s().transactions).toHaveLength(1); // the row is still there
    expect(live(s().transactions)).toHaveLength(0); // but excluded from totals
    expect(balanceOf(computeBalances(s().transactions), cash)).toBe(0);

    await s().restoreTransaction(id);
    expect(live(s().transactions)).toHaveLength(1);
    expect(balanceOf(computeBalances(s().transactions), cash)).toBe(rs(-900));

    expect(historyFor(s().ops, id).map((o) => o.type)).toEqual([
      'txn.created', 'txn.voided', 'txn.restored',
    ]);
  });

  it('refuses an edit that would unbalance the ledger, leaving the original intact', async () => {
    const { cash, groceries } = ids();
    const created = await s().createTransaction(expense(cash, groceries, rs(4000)));
    if (!created.ok) throw new Error('setup failed');

    const bad = await s().updateTransaction(created.value.id, expense(cash, groceries, 0));
    expect(bad.ok).toBe(false);
    expect(balanceOf(computeBalances(s().transactions), cash)).toBe(rs(-4000));
    expect(historyFor(s().ops, created.value.id)).toHaveLength(1); // no amend op written
  });
});

describe('§13 deleting a category never destroys history', () => {
  beforeEach(async () => {
    await useStore.getState().init(freshNamespace());
  });

  it('archives the category and leaves its transactions readable', async () => {
    const { cash, groceries } = ids();
    await s().createTransaction(expense(cash, groceries, rs(2500)));

    await s().archiveAccount(groceries, true);

    const category = s().accounts.find((a) => a.id === groceries)!;
    expect(category.archived).toBe(true);

    // The historical transaction still points at it and still totals correctly.
    const summary = summarisePeriod(s().transactions, s().accountMap(), monthRange('2026-09-15'), '2026-09-30');
    expect(summary.expenses).toBe(rs(2500));
    expect(s().transactions[0].postings.some((p) => p.accountId === groceries)).toBe(true);
  });

  it('blocks new spending on an archived category but not old', async () => {
    const { cash, groceries } = ids();
    await s().archiveAccount(groceries, true);
    const result = await s().createTransaction(expense(cash, groceries, rs(100)));
    expect(result.ok).toBe(false);
  });

  it('refuses to archive a system account', async () => {
    await s().archiveAccount('sys_adjustment', true);
    expect(s().accounts.find((a) => a.id === 'sys_adjustment')!.archived).toBe(false);
  });
});

describe('surviving an app restart', () => {
  it('reloads every figure from IndexedDB', async () => {
    const namespace = freshNamespace();
    await useStore.getState().init(namespace);
    const { cash, groceries, salary } = ids();

    await s().createTransaction({ type: 'earn', date: '2026-09-01', accountId: cash, allocations: [{ categoryId: salary, amount: rs(50000) }] });
    await s().createTransaction(expense(cash, groceries, rs(1200)));
    const balanceBefore = balanceOf(computeBalances(s().transactions), cash);
    const opCountBefore = s().ops.length;

    // Simulate a cold start: clear memory, then boot from storage.
    useStore.setState({ transactions: [], accounts: [], ops: [], status: 'idle' });
    await useStore.getState().init(namespace);

    expect(s().status).toBe('ready');
    expect(s().transactions).toHaveLength(2);
    expect(balanceOf(computeBalances(s().transactions), cash)).toBe(balanceBefore);
    expect(s().ops).toHaveLength(opCountBefore);
  });

  it('keeps two accounts' + ' data separate on the same device', async () => {
    const nsA = freshNamespace();
    const nsB = freshNamespace();

    await useStore.getState().init(nsA);
    const a = ids();
    await s().createTransaction(expense(a.cash, a.groceries, rs(1000)));
    expect(s().transactions).toHaveLength(1);

    await useStore.getState().init(nsB);
    expect(s().transactions).toHaveLength(0); // a different person's ledger

    await useStore.getState().init(nsA);
    expect(s().transactions).toHaveLength(1); // and the first is untouched
  });
});

describe('backup and restore', () => {
  it('round-trips a full ledger', async () => {
    const namespace = freshNamespace();
    await useStore.getState().init(namespace);
    const { cash, groceries } = ids();
    await s().createTransaction(expense(cash, groceries, rs(3300)));

    const snapshot = await s().exportBackup();
    expect(snapshot.format).toBe('pocketa.snapshot');
    expect(snapshot.counts.transactions).toBe(1);

    // Wipe, then restore.
    await s().resetEverything();
    expect(s().transactions).toHaveLength(0);

    const restored = await s().restoreBackup(snapshot);
    expect(restored.ok).toBe(true);
    expect(s().transactions).toHaveLength(1);
    expect(balanceOf(computeBalances(s().transactions), cash)).toBe(rs(-3300));
  });

  it('rejects a file that is not a Pocketa backup', async () => {
    await useStore.getState().init(freshNamespace());
    expect((await s().restoreBackup({ hello: 'world' })).ok).toBe(false);
    expect((await s().restoreBackup(null)).ok).toBe(false);
    expect((await s().restoreBackup({ format: 'pocketa.snapshot', version: 99 })).ok).toBe(false);
  });

  it('records the restore in the audit history', async () => {
    const namespace = freshNamespace();
    await useStore.getState().init(namespace);
    const snapshot = await s().exportBackup();
    await s().restoreBackup(snapshot);
    expect(s().ops.some((o) => o.type === 'data.restored')).toBe(true);
  });
});

describe('recurrence overrides', () => {
  beforeEach(async () => {
    await useStore.getState().init(freshNamespace());
  });

  it('stores a per-occurrence override without touching the template', async () => {
    const { cash, groceries } = ids();
    const rec = {
      id: 'rec_test', name: 'Internet', kind: 'expense' as const, amount: rs(4000), currency: 'PKR',
      accountId: cash, categoryId: groceries, toAccountId: null, merchant: null, notes: null, tags: [],
      frequency: 'monthly' as const, interval: 1, byWeekday: null, byMonthDay: 10,
      startDate: '2026-01-10', endDate: null, maxOccurrences: null, leadDays: 7, autoPost: false,
      archived: false, isBill: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
    await s().saveRecurrence(rec, true);

    await s().setOccurrence({
      id: 'ovr_test', recurrenceId: 'rec_test', dueDate: '2026-04-10', status: 'upcoming',
      amount: rs(4800), paidDate: null, txnId: null, notes: null,
      createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z',
    });

    expect(s().recurrences.find((r) => r.id === 'rec_test')!.amount).toBe(rs(4000));
    expect(s().overrides.find((o) => o.dueDate === '2026-04-10')!.amount).toBe(rs(4800));

    await s().clearOccurrence('rec_test', '2026-04-10');
    expect(s().overrides).toHaveLength(0);
    expect(s().recurrences.find((r) => r.id === 'rec_test')!.amount).toBe(rs(4000));
  });
});

describe('settings', () => {
  beforeEach(async () => {
    await useStore.getState().init(freshNamespace());
  });

  it('records a base currency change in the audit trail', async () => {
    await s().updateSettings({ baseCurrency: 'USD' });
    expect(s().settings.baseCurrency).toBe('USD');
    const op = s().ops.find((o) => o.type === 'settings.changed')!;
    expect(op.changes!.some((c) => c.before === 'PKR' && c.after === 'USD')).toBe(true);
  });

  it('writes no op when nothing actually changed', async () => {
    const before = s().ops.length;
    await s().updateSettings({ baseCurrency: 'PKR' });
    expect(s().ops).toHaveLength(before);
  });
});

describe('seeding is idempotent', () => {
  it('seeds exactly one set of defaults when init races with itself', async () => {
    // React re-invokes effects in development, so two boots can overlap. Before
    // this was guarded, both saw "no settings yet" and each wrote a full set of
    // categories, leaving the user with two of everything.
    const namespace = freshNamespace();
    await Promise.all([
      useStore.getState().init(namespace),
      useStore.getState().init(namespace),
      useStore.getState().init(namespace),
    ]);

    const housing = s().accounts.filter((a) => a.name === 'Housing');
    expect(housing).toHaveLength(1);

    const systemAccounts = s().accounts.filter((a) => a.system);
    expect(systemAccounts).toHaveLength(2);

    const names = s().accounts.map((a) => `${a.class}:${a.name}:${a.parentId ?? ''}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it('does not re-seed when init is called again later', async () => {
    const namespace = freshNamespace();
    await useStore.getState().init(namespace);
    const before = s().accounts.length;

    await useStore.getState().init(namespace);
    await useStore.getState().init(namespace);

    expect(s().accounts).toHaveLength(before);
  });
});

describe('database isolation', () => {
  it('opens a distinct database per namespace', async () => {
    const a = getDb('test_ns_a');
    const b = getDb('test_ns_b');
    expect(a.name).not.toBe(b.name);
    expect(a.name).toContain('test_ns_a');
  });
});
