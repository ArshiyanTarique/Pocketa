/**
 * The database contract.
 *
 * The ledger's correctness rules are proven in `ledger.test.ts` against pure
 * functions. This file proves the other half: that what those functions produce
 * actually reaches the disk intact, and that a failure halfway through leaves
 * nothing behind.
 *
 * Each block is one of the four properties, tested by breaking it on purpose.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStore } from './useStore';
import { getDb, namespaceForUser } from '../data/db';
import { computeBalances, balanceOf } from '../core/projections';
import { checkIntegrity } from '../data/integrity';
import type { TxnDraft } from '../core/draft';
import type { ID } from '../core/types';

let n = 0;
const freshNamespace = () => `acid_${Date.now()}_${++n}`;
const s = () => useStore.getState();

function ids() {
  const find = (cls: string, name: string): ID =>
    s().accounts.find((a) => a.class === cls && a.name === name)!.id;
  return {
    cash: find('cash', 'Cash'),
    groceries: find('expense_category', 'Groceries'),
  };
}

const spend = (amount: number, date = '2026-09-01'): TxnDraft => ({
  type: 'spend',
  date,
  accountId: ids().cash,
  merchant: 'Imtiaz',
  allocations: [{ categoryId: ids().groceries, amount }],
});

/** A second money account, so a transfer has somewhere to come from. */
async function addBank(): Promise<ID> {
  const id = `acc_bank_${++n}`;
  await s().saveAccount(
    {
      id,
      class: 'bank',
      name: 'Bank',
      parentId: null,
      currency: s().settings.baseCurrency,
      icon: null,
      color: null,
      archived: false,
      archivedAt: null,
      system: false,
      sortOrder: 1,
      notes: null,
      personId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    true,
  );
  return id;
}

let namespace: string;

beforeEach(async () => {
  namespace = freshNamespace();
  await useStore.getState().init(namespace);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------

describe('atomicity', () => {
  it('writes the transaction and the op that describes it, or neither', async () => {
    const db = getDb(namespace);
    const before = await db.transactions.count();

    // Fail on the second half of the write. Before the two were joined in one
    // IndexedDB transaction, this left a saved transaction with no audit entry:
    // invisible in history, and never synced, because the op is the unit of sync.
    vi.spyOn(db.ops, 'bulkPut').mockImplementation(() => {
      throw new Error('storage full');
    });

    await expect(s().createTransaction(spend(50000))).rejects.toThrow();

    expect(await db.transactions.count()).toBe(before);
  });

  it('leaves memory untouched when the write fails', async () => {
    const db = getDb(namespace);
    const before = s().transactions.length;

    vi.spyOn(db.ops, 'bulkPut').mockImplementation(() => {
      throw new Error('storage full');
    });

    await expect(s().createTransaction(spend(50000))).rejects.toThrow();

    // The screen must never show a figure the disk does not have.
    expect(s().transactions.length).toBe(before);
    expect(await db.transactions.count()).toBe(before);
  });

  it('rolls the op back when the entity write fails', async () => {
    const db = getDb(namespace);
    const opsBefore = await db.ops.count();

    vi.spyOn(db.transactions, 'put').mockImplementation(() => {
      throw new Error('disk error');
    });

    await expect(s().createTransaction(spend(50000))).rejects.toThrow();

    expect(await db.ops.count()).toBe(opsBefore);
    expect(s().ops.length).toBe(opsBefore);
  });

  it('imports a batch whole, or not at all', async () => {
    const db = getDb(namespace);
    const before = await db.transactions.count();
    const drafts = [spend(1000), spend(2000), spend(3000)];

    vi.spyOn(db.ops, 'bulkPut').mockImplementation(() => {
      throw new Error('interrupted');
    });

    await expect(
      s().createTransactions(drafts, {
        id: 'imp_1',
        fileName: 'sept.csv',
        importedCount: 0,
        skippedCount: 0,
        rowCount: 3,
        createdAt: new Date().toISOString(),
      } as never),
    ).rejects.toThrow();

    // A half-written import is the failure the feature exists to avoid.
    expect(await db.transactions.count()).toBe(before);
    expect(await db.imports.count()).toBe(0);
  });

  it('detaches a receipt and its reference together', async () => {
    const db = getDb(namespace);
    const created = await s().createTransaction(spend(50000));
    expect(created.ok).toBe(true);
    const txnId = created.ok ? created.value.id : '';

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'receipt.png', { type: 'image/png' });
    const added = await s().addAttachment(file, txnId);
    expect(added.ok).toBe(true);
    await s().linkAttachments(txnId, [added.id!]);

    expect((await db.transactions.get(txnId))!.attachmentIds).toEqual([added.id]);

    vi.spyOn(db.transactions, 'put').mockImplementation(() => {
      throw new Error('disk error');
    });
    await expect(s().removeAttachment(added.id!)).rejects.toThrow();

    // Neither an orphaned blob eating the cap, nor a dangling id.
    expect(await db.attachments.get(added.id!)).toBeDefined();
    expect((await db.transactions.get(txnId))!.attachmentIds).toEqual([added.id]);
  });
});

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

describe('consistency', () => {
  it('every persisted transaction has postings summing to zero', async () => {
    const db = getDb(namespace);
    await s().createTransaction(spend(125000));
    const bank = await addBank();
    await s().createTransaction({
      type: 'move',
      kind: 'transfer',
      date: '2026-09-02',
      fromAccountId: bank,
      toAccountId: ids().cash,
      amount: 200000,
    });
    await s().createTransaction({
      type: 'spend',
      date: '2026-09-03',
      accountId: ids().cash,
      merchant: 'Split',
      allocations: [
        { categoryId: ids().groceries, amount: 33333 },
        { categoryId: ids().groceries, amount: 33333 },
        { categoryId: ids().groceries, amount: 33334 },
      ],
    });

    const rows = await db.transactions.toArray();
    expect(rows.length).toBe(3);
    for (const txn of rows) {
      expect(txn.postings.reduce((t, p) => t + p.amount, 0)).toBe(0);
      expect(txn.postings.reduce((t, p) => t + p.baseAmount, 0)).toBe(0);
    }
  });

  it('balances read back from disk match the ones in memory', async () => {
    await s().createTransaction(spend(125000));
    await s().createTransaction(spend(75000));

    const inMemory = balanceOf(computeBalances(s().transactions), ids().cash);

    // Same namespace, re-read from IndexedDB rather than trusted from memory.
    await useStore.getState().init(namespace);
    const fromDisk = balanceOf(computeBalances(s().transactions), ids().cash);

    expect(fromDisk).toBe(inMemory);
  });

  it('never stores a balance, only the postings it is summed from', async () => {
    const db = getDb(namespace);
    await s().createTransaction(spend(125000));

    const account = await db.accounts.get(ids().cash);
    expect(account).toBeDefined();
    expect(Object.keys(account!)).not.toContain('balance');
  });

  it('refuses to persist an amount that is not a whole minor unit', async () => {
    const db = getDb(namespace);
    const result = await s().createTransaction(spend(12.5));
    expect(result.ok).toBe(false);
    expect(await db.transactions.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe('isolation', () => {
  it('loses nothing when many writes are issued at once', async () => {
    const db = getDb(namespace);
    const count = 25;

    // Fired without awaiting in between: the interleaving IndexedDB has to
    // serialise. A lost update here would show up as a missing row.
    const results = await Promise.all(
      Array.from({ length: count }, (_, i) => s().createTransaction(spend(1000 + i))),
    );

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await db.transactions.count()).toBe(count);
    expect(await db.ops.count()).toBe(count);
    expect(s().transactions.length).toBe(count);
  });

  it('gives every op a distinct sequence number', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => s().createTransaction(spend(1000 + i))));

    const lamports = s().ops.map((o) => o.lamport);
    expect(new Set(lamports).size).toBe(lamports.length);
  });

  it('seeds a namespace exactly once even when booted concurrently', async () => {
    const shared = freshNamespace();
    await Promise.all([
      useStore.getState().init(shared),
      useStore.getState().init(shared),
      useStore.getState().init(shared),
    ]);

    const db = getDb(shared);
    const accounts = await db.accounts.toArray();
    const names = accounts.filter((a) => a.class === 'expense_category').map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps two namespaces completely separate', async () => {
    await s().createTransaction(spend(50000));

    const other = freshNamespace();
    await useStore.getState().init(other);
    expect(s().transactions.length).toBe(0);

    await useStore.getState().init(namespace);
    expect(s().transactions.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Durability
// ---------------------------------------------------------------------------

describe('durability', () => {
  it('survives a restart with the ledger and its history intact', async () => {
    await s().createTransaction(spend(125000));
    const created = s().transactions[0];
    await s().updateTransaction(created.id, { ...spend(99000), id: created.id } as TxnDraft);
    await s().voidTransaction(created.id);

    // Simulate the tab being closed and reopened.
    await useStore.getState().init(namespace);

    expect(s().transactions.length).toBe(1);
    expect(s().transactions[0].voided).toBe(true);
    expect(s().ops.map((o) => o.type)).toEqual([
      'txn.created',
      'txn.amended',
      'txn.voided',
    ]);
  });

  it('does not report success before the write has landed', async () => {
    const db = getDb(namespace);
    const promise = s().createTransaction(spend(50000));

    // The call has been issued but not awaited: nothing may be visible yet.
    const result = await promise;
    expect(result.ok).toBe(true);

    // Immediately readable from storage, with no further await.
    expect(await db.transactions.count()).toBe(1);
  });

  it('records emptying the bin, rather than deleting silently', async () => {
    await s().createTransaction(spend(50000));
    await s().voidTransaction(s().transactions[0].id);

    const removed = await s().purgeVoided();
    expect(removed).toBe(1);

    const db = getDb(namespace);
    expect(await db.transactions.count()).toBe(0);
    expect(s().ops.map((o) => o.type)).toContain('data.purged');

    // And it survives the restart, so the gap in the ledger is explained.
    await useStore.getState().init(namespace);
    expect(s().ops.map((o) => o.type)).toContain('data.purged');
  });

  it('keeps a restored backup and its record together', async () => {
    await s().createTransaction(spend(125000));
    const snapshot = await s().exportBackup(false);

    await s().createTransaction(spend(999000));
    expect(s().transactions.length).toBe(2);

    const restored = await s().restoreBackup(snapshot);
    expect(restored.ok).toBe(true);
    expect(s().transactions.length).toBe(1);
    expect(s().ops.map((o) => o.type)).toContain('data.restored');
  });
});

// ---------------------------------------------------------------------------
// Referential integrity
// ---------------------------------------------------------------------------

describe('referential integrity', () => {
  it('clears what pointed at a transaction before purging it', async () => {
    const db = getDb(namespace);

    const original = await s().createTransaction(spend(50000));
    expect(original.ok).toBe(true);
    const originalId = original.ok ? original.value.id : '';

    // A refund pointing at it, and a receipt attached to it.
    const refund = await s().createTransaction({
      type: 'refund',
      date: '2026-09-05',
      originalTxnId: originalId,
      toAccountId: ids().cash,
      allocations: [{ categoryId: ids().groceries, amount: 20000 }],
    });
    expect(refund.ok).toBe(true);

    const file = new File([new Uint8Array([9, 9])], 'r.png', { type: 'image/png' });
    const added = await s().addAttachment(file, originalId);
    await s().linkAttachments(originalId, [added.id!]);

    await s().voidTransaction(originalId);
    await s().purgeVoided();

    // IndexedDB has no ON DELETE, so the referents are cleared by hand — or
    // they are left pointing at a row that no longer exists.
    const rows = await db.transactions.toArray();
    expect(rows.some((t) => t.id === originalId)).toBe(false);
    expect(rows.find((t) => t.id !== originalId)!.linkedTxnId).toBeNull();
    expect(await db.attachments.get(added.id!)).toBeUndefined();

    const audit = checkIntegrity({ ...s(), settings: [s().settings] });
    expect(audit.issues.filter((i) => i.code.startsWith('orphan'))).toEqual([]);
  });

  it('refuses a backup that does not add up', async () => {
    const db = getDb(namespace);
    await s().createTransaction(spend(50000));
    const snapshot = await s().exportBackup(false);

    // Tamper with one side, the way a truncated file or a bad merge would.
    snapshot.data.transactions[0].postings[0].amount += 1;

    const result = await s().restoreBackup(snapshot);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/balance|damaged/i);

    // And nothing was written: the existing ledger is untouched.
    expect(await db.transactions.count()).toBe(1);
  });

  it('mends a dangling reference rather than refusing the whole restore', async () => {
    await s().createTransaction(spend(50000));
    const snapshot = await s().exportBackup(false);
    snapshot.data.transactions[0].linkedTxnId = 'txn_that_never_existed';

    const result = await s().restoreBackup(snapshot);
    expect(result.ok).toBe(true);
    expect(s().transactions[0].linkedTxnId).toBeNull();
    expect(s().ops.some((o) => o.summary.includes('mending'))).toBe(true);
  });

  it('keeps the live ledger free of integrity issues after ordinary use', async () => {
    await s().createTransaction(spend(125000));
    const first = s().transactions[0];
    await s().updateTransaction(first.id, { ...spend(99000), id: first.id } as TxnDraft);
    await s().voidTransaction(first.id);
    await s().restoreTransaction(first.id);
    await addBank();

    const report = checkIntegrity({ ...s(), settings: [s().settings] });
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('will not store two overrides for the same bill occurrence', async () => {
    const db = getDb(namespace);
    const row = {
      recurrenceId: 'rec_1',
      dueDate: '2026-09-01',
      status: 'paid' as const,
      amount: null,
      paidDate: null,
      txnId: null,
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.overrides.put({ ...row, id: 'ovr_1' });
    // The unique index is the constraint: the same occurrence cannot be both
    // paid and skipped, whatever a bad merge or a race tries to write.
    await expect(db.overrides.put({ ...row, id: 'ovr_2', status: 'skipped' })).rejects.toThrow();
    expect(await db.overrides.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Signing in for the first time
// ---------------------------------------------------------------------------

describe('adopting an offline ledger into a new account', () => {
  // These share the one `local` namespace by definition — it is the device's
  // anonymous ledger — so each starts from a device that has never been used.
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('pocketa_local');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it('carries the device ledger across, so signing in is not losing everything', async () => {
    // Somebody who used the app anonymously for a while.
    await useStore.getState().init('local');
    await s().createTransaction(spend(125000));
    await s().createTransaction(spend(40000));
    expect(s().transactions.length).toBe(2);

    const userId = `user-${Date.now()}`;
    const adopted = await s().switchAccount(userId);

    expect(adopted).toBeGreaterThan(0);
    expect(s().namespace).toBe(namespaceForUser(userId));
    expect(s().transactions.length).toBe(2);

    // The history came too, so the account syncs its whole past rather than
    // starting from the day it was created.
    expect(s().ops.length).toBeGreaterThanOrEqual(2);

    // And the device copy is untouched, so signing out loses nothing either.
    await s().switchAccount(null);
    expect(s().transactions.length).toBe(2);
  });

  it('does not hand one person the ledger of whoever used the device before', async () => {
    await useStore.getState().init('local');
    await s().createTransaction(spend(50000));
    const mine = s().transactions.length;

    const first = `user-a-${Date.now()}`;
    expect(await s().switchAccount(first)).toBeGreaterThan(0);

    // A second account on the same phone starts empty.
    const second = `user-b-${Date.now()}`;
    const adopted = await s().switchAccount(second);
    expect(adopted).toBe(0);
    expect(s().transactions.length).toBe(0);

    // The first account still has it.
    await s().switchAccount(first);
    expect(s().transactions.length).toBe(mine);
  });

  it('leaves an account that already has data alone', async () => {
    const userId = `user-c-${Date.now()}`;
    await s().switchAccount(userId);
    await s().createTransaction(spend(70000));
    const theirs = s().transactions.length;

    await s().switchAccount(null);
    await s().switchAccount(userId);
    expect(s().transactions.length).toBe(theirs);
  });
});
