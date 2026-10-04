import { describe, it, expect } from 'vitest';
import { useStore } from '../store/useStore';
import { getDb } from './db';
import { ALIAS_OP, starterId } from './starters';
import { rs } from '../test/fixtures';
import type { Op } from './oplog';
import type { Account, ID, Transaction } from '../core/types';

let ns = 0;
const fresh = () => `starters_${Date.now()}_${++ns}`;
const s = () => useStore.getState();
const CASH = starterId('cash', 'Cash');
const GROCERIES = starterId('expense_category', 'Groceries');

/** Reopen a namespace so its startup repairs run. */
async function reboot(namespace: string) {
  await s().init(fresh());
  await s().init(namespace);
}

function opsSince(before: number, seqBase: number): Op[] {
  return s().ops.slice(before).map((op, i) => ({ ...op, serverSeq: seqBase + i }));
}

// ---------------------------------------------------------------------------
// Building a device as it looked before shared ids: every starter under a
// random id, in its tables and in the ops it has sent.
// ---------------------------------------------------------------------------

type IdMap = Map<ID, ID>;

const swap = (m: IdMap, id: ID | null | undefined) => (id != null ? m.get(id) ?? id : id ?? null);

function legacyOp(op: Op, m: IdMap): Op {
  const snap = op.snapshot as Record<string, unknown> | null;
  let snapshot: unknown = snap;
  if (snap) {
    const next: Record<string, unknown> = { ...snap };
    if (typeof next.id === 'string') next.id = swap(m, next.id);
    if (typeof next.parentId === 'string') next.parentId = swap(m, next.parentId);
    if (Array.isArray(next.postings)) {
      next.postings = (next.postings as Array<{ accountId: ID }>).map((p) => ({ ...p, accountId: swap(m, p.accountId)! }));
    }
    snapshot = next;
  }
  return { ...op, entityId: swap(m, op.entityId)!, snapshot };
}

async function makeLegacy(namespace: string, prefix: string): Promise<IdMap> {
  const db = getDb(namespace);
  const accounts = await db.accounts.toArray();
  const m: IdMap = new Map();
  accounts.filter((a) => a.id.startsWith('st_')).forEach((a, i) => m.set(a.id, `${prefix}_${i}`));
  await db.transaction('rw', db.tables, async () => {
    await db.accounts.bulkDelete([...m.keys()]);
    await db.accounts.bulkPut(accounts.map((a) => ({ ...a, id: swap(m, a.id)!, parentId: swap(m, a.parentId) })));
    const txns = await db.transactions.toArray();
    await db.transactions.bulkPut(txns.map((t) => ({ ...t, postings: t.postings.map((p) => ({ ...p, accountId: swap(m, p.accountId)! })) })));
    const ops = await db.ops.toArray();
    await db.ops.bulkPut(ops.map((o) => legacyOp(o, m)));
  });
  return m;
}

/** What an older build did with pulled ops: store them, put every snapshot. */
async function oldBuildIngest(namespace: string, ops: Op[]) {
  const db = getDb(namespace);
  await db.ops.bulkPut(ops);
  for (const op of ops) {
    if (!op.snapshot) continue;
    if (op.entity === 'account') await db.accounts.put(op.snapshot as Account);
    if (op.entity === 'transaction') await db.transactions.put(op.snapshot as Transaction);
  }
}

async function spend(accountId: ID, categoryId: ID, amount: number) {
  const r = await s().createTransaction({ type: 'spend', date: '2026-10-01', accountId, merchant: 'Imtiaz', allocations: [{ categoryId, amount }] });
  expect(r.ok).toBe(true);
  return r.ok ? r.value.id : '';
}

const cashAccounts = () => s().accounts.filter((a) => a.class === 'cash');

// ---------------------------------------------------------------------------

describe('new devices', () => {
  it('give every starter the same id on every device', async () => {
    await s().init(fresh());
    const a = s().accounts.filter((x) => !x.system).map((x) => x.id).sort();
    await s().init(fresh());
    const b = s().accounts.filter((x) => !x.system).map((x) => x.id).sort();
    expect(a).toEqual(b);
    expect(a).toContain(CASH);
    expect(a).toContain(GROCERIES);
  });
});

describe('devices set up before shared ids', () => {
  it('end up with one Cash and the same categories once both update', async () => {
    // Phone: edits Cash and spends on Groceries, under its old ids.
    const phone = fresh();
    await s().init(phone);
    const start = s().ops.length;
    const cash = s().accounts.find((a) => a.id === CASH)!;
    await s().saveAccount({ ...cash, color: '#123456' });
    const txnId = await spend(CASH, GROCERIES, rs(500));
    const phoneMap = await makeLegacy(phone, 'ph');
    const sent = opsSince(start, 100).map((o) => legacyOp(o, phoneMap));

    // Laptop: its own old ids, plus the phone's ops as an older build stored them.
    const laptop = fresh();
    await s().init(laptop);
    await makeLegacy(laptop, 'lp');
    await oldBuildIngest(laptop, sent);
    {
      const db = getDb(laptop);
      expect((await db.accounts.toArray()).filter((a) => a.class === 'cash')).toHaveLength(2); // the bug
    }

    // Laptop updates.
    await reboot(laptop);
    expect(cashAccounts().map((a) => a.id)).toEqual([CASH]);
    expect(cashAccounts()[0].color).toBe('#123456'); // the edited one wins over an untouched seed
    expect(s().accounts.some((a) => a.id.startsWith('lp_') || a.id.startsWith('ph_'))).toBe(false);
    // The phone's Groceries id never reached the laptop as an account, so it
    // waits for the phone to say what it was.
    const before = s().transactions.find((t) => t.id === txnId)!;
    expect(before.postings.map((p) => p.accountId)).toContain(phoneMap.get(GROCERIES));

    // Phone updates, and announces its old ids.
    await reboot(phone);
    expect(cashAccounts().map((a) => a.id)).toEqual([CASH]);
    const aliases = s().ops.filter((o) => o.type === ALIAS_OP).map((o, i) => ({ ...o, serverSeq: 500 + i }));
    expect(aliases.length).toBeGreaterThan(0);

    // The laptop learns them and files the phone's spend under the shared Groceries.
    await s().init(laptop);
    await s().ingestRemoteOps(aliases);
    const after = s().transactions.find((t) => t.id === txnId)!;
    expect(after.postings.map((p) => p.accountId).sort()).toEqual([CASH, GROCERIES].sort());
  });

  it('deletes Cash everywhere when it was deleted on one device', async () => {
    const phone = fresh();
    await s().init(phone);
    const start = s().ops.length;
    await s().deleteAccount(CASH);
    const phoneMap = await makeLegacy(phone, 'ph');
    const sent = opsSince(start, 100).map((o) => legacyOp(o, phoneMap));

    const laptop = fresh();
    await s().init(laptop);
    const laptopTxn = await spend(CASH, GROCERIES, rs(200));
    await makeLegacy(laptop, 'lp');
    await oldBuildIngest(laptop, sent);

    await reboot(laptop);
    expect(cashAccounts()).toHaveLength(0);
    // As on the device that deleted it: its transactions are voided, kept in history.
    expect(s().transactions.find((t) => t.id === laptopTxn)?.voided).toBe(true);
  });

  it('leaves a Cash the person made themselves alone', async () => {
    const laptop = fresh();
    await s().init(laptop);
    const now = new Date().toISOString();
    await s().saveAccount(
      { id: 'acc_mine', class: 'cash', name: 'Cash', parentId: null, currency: 'PKR', icon: null, color: null,
        archived: false, archivedAt: null, system: false, sortOrder: 1, notes: null, createdAt: now, updatedAt: now },
      true,
    );
    await makeLegacy(laptop, 'lp');
    await reboot(laptop);
    expect(cashAccounts().map((a) => a.id).sort()).toEqual(['acc_mine', CASH].sort());
  });

  it('keeps a renamed starter as that starter', async () => {
    const laptop = fresh();
    await s().init(laptop);
    const groceries = s().accounts.find((a) => a.id === GROCERIES)!;
    await s().saveAccount({ ...groceries, name: 'Food shop' });
    await makeLegacy(laptop, 'lp');
    await reboot(laptop);
    const row = s().accounts.find((a) => a.id === GROCERIES);
    expect(row?.name).toBe('Food shop');
  });

  it('does nothing the second time', async () => {
    const laptop = fresh();
    await s().init(laptop);
    await spend(CASH, GROCERIES, rs(100));
    await makeLegacy(laptop, 'lp');
    await reboot(laptop);
    const opsAfterFirst = s().ops.length;
    const snapshot = JSON.stringify([s().accounts.map((a) => a.id).sort(), s().transactions.map((t) => t.postings)]);
    await reboot(laptop);
    expect(s().ops.length).toBe(opsAfterFirst);
    expect(JSON.stringify([s().accounts.map((a) => a.id).sort(), s().transactions.map((t) => t.postings)])).toBe(snapshot);
  });

  it('keeps balances exactly the same', async () => {
    const laptop = fresh();
    await s().init(laptop);
    await spend(CASH, GROCERIES, rs(750));
    const { computeBalances, balanceOf } = await import('../core/projections');
    const live = () => s().transactions.filter((t) => !t.voided);
    const before = balanceOf(computeBalances(live()), CASH);
    const m = await makeLegacy(laptop, 'lp');
    expect(balanceOf(computeBalances((await getDb(laptop).transactions.toArray()).filter((t) => !t.voided)), m.get(CASH)!)).toBe(before);
    await reboot(laptop);
    expect(balanceOf(computeBalances(live()), CASH)).toBe(before);
  });
});
