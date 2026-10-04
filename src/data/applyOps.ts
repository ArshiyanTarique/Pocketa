/**
 * Applying a peer's ops to this device's tables.
 *
 * An op carries the full entity it changed, so applying one is a put — except
 * when the op records a deletion. A deletion is sent as the last known state of
 * the row with `deleted: true` (so the audit trail still shows what was
 * removed); applying that with a put would write the row straight back in. That
 * was the bug: delete on the phone, and the laptop resurrected it.
 *
 * The tombstone sweep repairs devices that already ingested deletions the old
 * way, and also covers deletions recorded before every cascaded row was logged:
 * a deleted person takes their linked accounts and debts with them, and a
 * deleted account voids the live transactions that touch it, exactly as the
 * deleting device did.
 */

import type { Table } from 'dexie';
import { nowIso } from '../core/dates';
import type { Account, Debt, ID, Transaction } from '../core/types';
import { compareOps, type Op } from './oplog';
import type { PocketaDB } from './db';

type EntityTable =
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'recurrences'
  | 'overrides'
  | 'goals'
  | 'debts'
  | 'people'
  | 'carpools'
  | 'carpoolRiders'
  | 'carpoolTrips'
  | 'carpoolSettlements';

/** The local table an op's entity lives in, or null for ops that change no row here. */
export function tableFor(op: Pick<Op, 'entity' | 'type'>): EntityTable | null {
  switch (op.entity) {
    case 'transaction':
      return 'transactions';
    case 'account':
      return 'accounts';
    case 'budget':
      return 'budgets';
    case 'recurrence':
      return 'recurrences';
    case 'occurrence':
      return 'overrides';
    case 'goal':
      return 'goals';
    case 'debt':
      return 'debts';
    case 'person':
      return 'people';
    // Riders are logged under the carpool entity; the op type tells them apart.
    case 'carpool':
      return op.type.startsWith('carpool.rider_') ? 'carpoolRiders' : 'carpools';
    case 'carpool_trip':
      return 'carpoolTrips';
    case 'carpool_settlement':
      return 'carpoolSettlements';
    default:
      return null; // settings are per device; imports carry no row of their own
  }
}

/** True when the op removed its entity rather than writing it. */
export function isDeletion(op: Pick<Op, 'type' | 'snapshot'>): boolean {
  const row = op.snapshot as { deleted?: unknown } | null;
  if (row && row.deleted === true) return true;
  if (op.type === 'carpool.trip_removed') return true;
  // Resetting a bill to its schedule removes the override, logged with no snapshot.
  if (op.type === 'occurrence.overridden' && row == null) return true;
  return false;
}

function table(database: PocketaDB, name: EntityTable): Table<{ id: ID }, string> {
  return database[name] as unknown as Table<{ id: ID }, string>;
}

/**
 * Write one peer op into the local tables. Must run inside a transaction that
 * covers the entity tables. `accept` is the caller's validity check for rows
 * that are written (deletions only need an id).
 */
export async function applyRemoteOp(
  database: PocketaDB,
  op: Op,
  accept: (op: Op) => boolean,
): Promise<void> {
  const name = tableFor(op);
  if (!name) return;
  if (isDeletion(op)) {
    if (op.entityId) await table(database, name).delete(op.entityId);
    return;
  }
  if (op.snapshot == null || !accept(op)) return;
  await table(database, name).put(op.snapshot as { id: ID });
}

/**
 * Remove every row whose latest op is a deletion, with the cascades the
 * deleting device performed. Idempotent: a clean device finds nothing to do.
 * Returns how many rows it changed.
 */
export async function sweepTombstones(database: PocketaDB, ops: readonly Op[]): Promise<number> {
  // The last op per entity decides. A row deleted and later recreated under the
  // same id (a restore) stays.
  const latest = new Map<string, Op>();
  for (const op of [...ops].sort(compareOps)) {
    const name = tableFor(op);
    if (!name || !op.entityId) continue;
    latest.set(`${name}:${op.entityId}`, op);
  }

  const doomed = new Map<EntityTable, Set<ID>>();
  const mark = (name: EntityTable, id: ID) => {
    if (!doomed.has(name)) doomed.set(name, new Set());
    doomed.get(name)!.add(id);
  };
  for (const [key, op] of latest) {
    if (isDeletion(op)) mark(key.slice(0, key.indexOf(':')) as EntityTable, op.entityId);
  }
  const deadPeople = doomed.get('people') ?? new Set<ID>();
  const deadAccounts = doomed.get('accounts') ?? new Set<ID>();
  if (deadPeople.size === 0 && deadAccounts.size === 0 && doomed.size === 0) return 0;

  let changed = 0;
  await database.transaction('rw', database.tables, async () => {
    // A deleted person's ledger accounts and debts go with them.
    if (deadPeople.size > 0) {
      const linked = (await database.accounts.toArray()).filter((a: Account) => a.personId && deadPeople.has(a.personId));
      for (const a of linked) mark('accounts', a.id);
      const debts = (await database.debts.toArray()).filter((d: Debt) => deadPeople.has(d.personId));
      for (const d of debts) mark('debts', d.id);
    }

    // Transactions that touch a deleted account are voided, not removed — the
    // deleting device kept them in history the same way.
    const accountsGone = doomed.get('accounts') ?? new Set<ID>();
    if (accountsGone.size > 0) {
      const stamp = nowIso();
      const toVoid = (await database.transactions.toArray()).filter(
        (t: Transaction) => !t.voided && t.postings.some((p) => accountsGone.has(p.accountId)),
      );
      if (toVoid.length > 0) {
        await database.transactions.bulkPut(toVoid.map((t) => ({ ...t, voided: true, voidedAt: stamp, updatedAt: stamp })));
        changed += toVoid.length;
      }
    }

    for (const [name, ids] of doomed) {
      const t = table(database, name);
      const present = (await t.bulkGet([...ids])).filter(Boolean).length;
      if (present > 0) {
        await t.bulkDelete([...ids]);
        changed += present;
      }
    }
  });
  return changed;
}
