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

// ---------------------------------------------------------------------------
// Carpool
// ---------------------------------------------------------------------------

import { settlementLines, summarisePeriod, isBilledFor } from '../core/carpool';
import { monthRange } from '../core/dates';
import { balanceOf, computeBalances } from '../core/projections';
import type { Carpool, CarpoolRider, CarpoolTrip } from '../core/types';

async function phoneCarpoolWithBill() {
  const stamp = '2026-10-01T08:00:00.000Z';
  const fuel = s().accounts.find((a) => a.class === 'expense_category')!.id;
  const carpool: Carpool = {
    id: 'cp_sync', name: 'Office run', ratePerTrip: rs(300), currency: 'PKR', settleAs: 'recovery',
    settleCategoryId: fuel, notes: null, archived: false, createdAt: stamp, updatedAt: stamp,
  };
  await s().saveCarpool(carpool, true);
  const { personId } = await s().addPerson('Bilal');
  const rider: CarpoolRider = {
    id: 'rd_bilal', carpoolId: carpool.id, personId, ratePerTrip: null, active: true, createdAt: stamp, updatedAt: stamp,
  };
  await s().saveCarpoolRider(rider, true);
  const trip: CarpoolTrip = {
    id: 'tp_1', carpoolId: carpool.id, date: '2026-10-02', riderIds: [rider.id], rates: { [rider.id]: rs(300) },
    note: null, settlementId: null, createdAt: stamp, updatedAt: stamp,
  };
  await s().logTrip(trip, true);
  const range = monthRange('2026-10-02');
  const summary = summarisePeriod({ carpool, riders: [rider], trips: s().carpoolTrips, people: s().people, range });
  const billed = await s().settleCarpool(carpool.id, range, settlementLines(summary.riders));
  expect(billed.ok).toBe(true);
  return { personId };
}

function owedBy(personId: ID): number {
  const receivable = s().accounts.find((a) => a.class === 'receivable' && a.personId === personId);
  if (!receivable) return 0;
  const balances = computeBalances(s().transactions.filter((t) => !t.voided));
  return balanceOf(balances, receivable.id);
}

describe('carpool data reaches other devices', () => {
  it('brings the carpool, riders, trips, the bill and what each rider owes', async () => {
    const { phone, laptop } = await twoDevices();
    const start = s().ops.length;
    const { personId } = await phoneCarpoolWithBill();
    const sent = opsSince(start);
    expect(owedBy(personId)).toBe(rs(300));

    await s().init(laptop);
    await s().ingestRemoteOps(sent);
    expect(s().carpools.map((c) => c.id)).toContain('cp_sync');
    expect(s().carpoolRiders.map((r) => r.id)).toContain('rd_bilal');
    expect(s().carpoolSettlements).toHaveLength(1);
    const trip = s().carpoolTrips.find((t) => t.id === 'tp_1')!;
    expect(isBilledFor(trip, 'rd_bilal')).toBe(true);
    expect(owedBy(personId)).toBe(rs(300));
    void phone;
  });

  it('rebuilds carpool data on a device that synced it under the old build', async () => {
    const { laptop } = await twoDevices();
    const start = s().ops.length;
    const { personId } = await phoneCarpoolWithBill();
    // What an older build sent: no charge transactions, no billed stamps.
    const sent = opsSince(start).filter(
      (op) => !(op.type === 'txn.created' && (op.snapshot as { kind?: string })?.kind === 'carpool_settlement')
        && !(op.type === 'carpool.trip_amended'),
    );
    const unbilledTrip = (sent.find((op) => op.entityId === 'tp_1')!.snapshot as CarpoolTrip);
    expect(unbilledTrip.settlementId).toBeNull();

    // ...and what it then did with them: stored the ops, wrote none of the carpool rows.
    await s().init(laptop);
    const db = getDb(laptop);
    await db.ops.bulkPut(sent);
    for (const op of sent) {
      if (op.entity === 'account' && op.snapshot) await db.accounts.put(op.snapshot as Account);
      if (op.entity === 'person' && op.snapshot) await db.people.put(op.snapshot as never);
    }

    await s().init(fresh());
    await s().init(laptop);
    expect(s().carpools.map((c) => c.id)).toContain('cp_sync');
    const trip = s().carpoolTrips.find((t) => t.id === 'tp_1')!;
    expect(isBilledFor(trip, 'rd_bilal')).toBe(true);
    expect(owedBy(personId)).toBe(rs(300));
  });
});

describe('a device’s own starter Cash after another device’s Cash arrives', () => {
  async function phoneCashArrives() {
    const { phone, laptop } = await twoDevices();
    const start = s().ops.length;
    const phoneCash = s().accounts.find((a) => a.class === 'cash')!;
    await s().saveAccount({ ...phoneCash, color: '#123456' }); // any edit puts it in the log
    const sent = opsSince(start);
    await s().init(laptop);
    const laptopCash = s().accounts.find((a) => a.class === 'cash')!;
    return { phone, laptop, sent, phoneCash, laptopCash };
  }

  it('keeps one Cash — the synced one — when the local starter is unused', async () => {
    const { sent, phoneCash, laptopCash } = await phoneCashArrives();
    expect(laptopCash.id).not.toBe(phoneCash.id);
    await s().ingestRemoteOps(sent);
    const cash = s().accounts.filter((a) => a.class === 'cash');
    expect(cash.map((a) => a.id)).toEqual([phoneCash.id]);
  });

  it('never removes a local Cash that has transactions on it', async () => {
    const { sent, laptopCash } = await phoneCashArrives();
    const groceries = s().accounts.find((a) => a.class === 'expense_category')!.id;
    const spent = await s().createTransaction({
      type: 'spend', date: '2026-10-01', accountId: laptopCash.id, merchant: 'Shop', allocations: [{ categoryId: groceries, amount: rs(100) }],
    });
    expect(spent.ok).toBe(true);
    await s().ingestRemoteOps(sent);
    expect(s().accounts.filter((a) => a.class === 'cash')).toHaveLength(2);
  });

  it('leaves a single device alone', async () => {
    await s().init(fresh());
    await s().init(fresh());
    expect(s().accounts.filter((a) => a.class === 'cash')).toHaveLength(1);
  });
});
