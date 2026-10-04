import { describe, it, expect } from 'vitest';
import { useStore } from '../store/useStore';
import { getDb } from './db';
import { makeOp } from './oplog';
import { isDeletion, tableFor } from './applyOps';
import { rs } from '../test/fixtures';
import type { Account, ID } from '../core/types';

let ns = 0;
const fresh = () => `sync_del_${Date.now()}_${++ns}`;
const s = () => useStore.getState();

/** Two devices on one store: switch between their namespaces. */
async function twoDevices() {
  const phone = fresh();
  const laptop = fresh();
  await s().init(laptop);
  await s().init(phone);
  return { phone, laptop };
}

/** Everything the phone has authored, as the laptop would pull it. */
function opsSince(before: number) {
  return s().ops.slice(before).map((op, i) => ({ ...op, serverSeq: 10_000 + before + i }));
}

function placeholder(id: ID, name: string): Account {
  const now = new Date().toISOString();
  return {
    id, class: 'cash', name, parentId: null, currency: 'PKR', icon: null, color: null,
    archived: false, archivedAt: null, system: false, sortOrder: 0, notes: null,
    createdAt: now, updatedAt: now,
  };
}

describe('deletions reach other devices', () => {
  it('removes an account the other device deleted, instead of writing it back', async () => {
    const { phone, laptop } = await twoDevices();
    const start = s().ops.length;
    await s().saveAccount(placeholder('acc_sd1', 'sd'), true);
    const created = opsSince(start);

    await s().init(laptop);
    await s().ingestRemoteOps(created);
    expect(s().accounts.some((a) => a.id === 'acc_sd1')).toBe(true);

    await s().init(phone);
    const before = s().ops.length;
    await s().deleteAccount('acc_sd1');
    const deleted = opsSince(before);

    await s().init(laptop);
    await s().ingestRemoteOps(deleted);
    expect(s().accounts.some((a) => a.id === 'acc_sd1')).toBe(false);
  });

  it('takes a deleted person’s accounts, debts and transactions with them', async () => {
    const { phone, laptop } = await twoDevices();
    const start = s().ops.length;
    const { personId, receivableId } = await s().addPerson('sd');
    const cash = s().accounts.find((a) => a.class === 'cash')!.id;
    const lent = await s().createTransaction({
      type: 'move', kind: 'lend', date: '2026-10-01', fromAccountId: cash, toAccountId: receivableId, amount: rs(500),
    });
    expect(lent.ok).toBe(true);
    const created = opsSince(start);

    await s().init(laptop);
    await s().ingestRemoteOps(created);
    expect(s().people.some((p) => p.id === personId)).toBe(true);

    await s().init(phone);
    const before = s().ops.length;
    await s().deletePerson(personId);
    const deleted = opsSince(before);

    await s().init(laptop);
    await s().ingestRemoteOps(deleted);
    expect(s().people.some((p) => p.id === personId)).toBe(false);
    expect(s().accounts.some((a) => a.personId === personId)).toBe(false);
    const txn = s().transactions.find((t) => lent.ok && t.id === lent.value.id);
    expect(txn?.voided).toBe(true);
  });
});

describe('repairing a device that already resurrected deletions', () => {
  it('removes rows whose latest op is a deletion when the app opens', async () => {
    const laptop = fresh();
    await s().init(laptop);
    const db = getDb(laptop);
    const row = placeholder('acc_ghost', 'sd');
    const state = { deviceId: 'dev_phone', lamport: 0 };
    // What an older build left behind: the delete op stored, the row put back.
    await db.ops.bulkPut([
      { ...makeOp(state, { type: 'account.created', entity: 'account', entityId: row.id, summary: 'c', snapshot: row }), serverSeq: 1 },
      { ...makeOp(state, { type: 'account.archived', entity: 'account', entityId: row.id, summary: 'd', snapshot: { ...row, deleted: true } }), serverSeq: 2 },
    ]);
    await db.accounts.put(row);

    await s().init(fresh()); // leave, so init(laptop) reboots rather than reuses
    await s().init(laptop);
    expect(s().accounts.some((a) => a.id === 'acc_ghost')).toBe(false);
  });

  it('keeps a row that was deleted and then created again', async () => {
    const laptop = fresh();
    await s().init(laptop);
    const db = getDb(laptop);
    const row = placeholder('acc_back', 'back');
    const state = { deviceId: 'dev_phone', lamport: 0 };
    await db.ops.bulkPut([
      { ...makeOp(state, { type: 'account.archived', entity: 'account', entityId: row.id, summary: 'd', snapshot: { ...row, deleted: true } }), serverSeq: 1 },
      { ...makeOp(state, { type: 'account.created', entity: 'account', entityId: row.id, summary: 'c', snapshot: row }), serverSeq: 2 },
    ]);
    await db.accounts.put(row);

    await s().init(fresh());
    await s().init(laptop);
    expect(s().accounts.some((a) => a.id === 'acc_back')).toBe(true);
  });
});

describe('op classification', () => {
  it('tells riders from carpools and recognises every deletion form', () => {
    expect(tableFor({ entity: 'carpool', type: 'carpool.rider_added' })).toBe('carpoolRiders');
    expect(tableFor({ entity: 'carpool', type: 'carpool.created' })).toBe('carpools');
    expect(tableFor({ entity: 'settings', type: 'settings.changed' })).toBeNull();
    expect(isDeletion({ type: 'account.archived', snapshot: { id: 'a', deleted: true } })).toBe(true);
    expect(isDeletion({ type: 'account.archived', snapshot: { id: 'a', archived: true } })).toBe(false);
    expect(isDeletion({ type: 'carpool.trip_removed', snapshot: { id: 't' } })).toBe(true);
    expect(isDeletion({ type: 'occurrence.overridden', snapshot: null })).toBe(true);
  });
});
