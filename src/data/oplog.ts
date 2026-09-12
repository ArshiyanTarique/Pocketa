/**
 * The operation log — audit history and sync payload in one structure.
 *
 * Every change to financial data appends an immutable op. Ops are never edited
 * and never deleted; a correction is a new op that supersedes an earlier one.
 * That single rule delivers three things the product needs:
 *
 *   - Audit history (§18). Changing Rs. 4,000 to Rs. 3,500 records both values
 *     and who changed them when, rather than overwriting the past.
 *   - Undo. Reverting is appending the inverse, not rewinding.
 *   - Sync. Two devices exchange ops and converge, because ops are idempotent
 *     (keyed by id) and ordered (by server sequence).
 *
 * Entity tables hold current state so reads stay fast; the log is the record of
 * how that state came to be. Replay is used for restore and for merging a peer's
 * ops, not on the read path.
 */

import { nowIso } from '../core/dates';
import { newId } from '../core/ids';
import type { ID, ISOTimestamp } from '../core/types';

export type OpType =
  | 'txn.created'
  | 'txn.amended'
  | 'txn.voided'
  | 'txn.restored'
  | 'account.created'
  | 'account.amended'
  | 'account.archived'
  | 'account.unarchived'
  | 'category.created'
  | 'category.amended'
  | 'category.archived'
  | 'budget.created'
  | 'budget.amended'
  | 'budget.archived'
  | 'recurrence.created'
  | 'recurrence.amended'
  | 'recurrence.archived'
  | 'occurrence.overridden'
  | 'goal.created'
  | 'goal.amended'
  | 'goal.archived'
  | 'debt.created'
  | 'debt.amended'
  | 'debt.settled'
  | 'person.created'
  | 'person.amended'
  | 'carpool.created'
  | 'carpool.amended'
  | 'carpool.rider_added'
  | 'carpool.rider_amended'
  | 'carpool.trip_logged'
  | 'carpool.trip_amended'
  | 'carpool.trip_removed'
  | 'carpool.settled'
  | 'import.committed'
  | 'settings.changed'
  | 'data.restored'
  | 'data.purged';

export type EntityKind =
  | 'transaction'
  | 'account'
  | 'budget'
  | 'recurrence'
  | 'occurrence'
  | 'goal'
  | 'debt'
  | 'person'
  | 'settings'
  | 'carpool'
  | 'carpool_trip'
  | 'carpool_settlement'
  | 'import';

/** A single recorded field change, for the audit trail. */
export interface FieldChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
  /** Rendered as money when true. */
  money?: boolean;
}

export interface Op {
  id: ID;
  type: OpType;
  entity: EntityKind;
  entityId: ID;
  /** Monotonic per device; breaks ties deterministically with deviceId. */
  lamport: number;
  deviceId: string;
  createdAt: ISOTimestamp;
  /** Human-readable one-liner for the history view. */
  summary: string;
  /** Field-level diff, present on amend ops. */
  changes: FieldChange[] | null;
  /** Full entity snapshot for create ops, so a replay can rebuild state. */
  snapshot: unknown;
  /** Server-assigned ordering, set once the op has been accepted upstream. */
  serverSeq: number | null;
  /** 0 = pending upload, 1 = acknowledged. Numeric so IndexedDB can index it. */
  synced: 0 | 1;
}

export interface OpFactoryState {
  deviceId: string;
  lamport: number;
}

export interface MakeOpInput {
  type: OpType;
  entity: EntityKind;
  entityId: ID;
  summary: string;
  changes?: FieldChange[] | null;
  snapshot?: unknown;
  now?: () => ISOTimestamp;
}

export function makeOp(state: OpFactoryState, input: MakeOpInput): Op {
  return {
    id: newId('op'),
    type: input.type,
    entity: input.entity,
    entityId: input.entityId,
    lamport: ++state.lamport,
    deviceId: state.deviceId,
    createdAt: (input.now ?? nowIso)(),
    summary: input.summary,
    changes: input.changes ?? null,
    snapshot: input.snapshot ?? null,
    serverSeq: null,
    synced: 0,
  };
}

/**
 * Total order across devices. Server sequence wins when both ops have one;
 * otherwise Lamport clock, with deviceId as a stable tiebreaker so two devices
 * independently sorting the same set produce the same order.
 */
export function compareOps(a: Op, b: Op): number {
  if (a.serverSeq != null && b.serverSeq != null) return a.serverSeq - b.serverSeq;
  if (a.serverSeq != null) return -1;
  if (b.serverSeq != null) return 1;
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Merge two op sets, keeping one copy of each id. Idempotent by construction. */
export function mergeOps(local: readonly Op[], remote: readonly Op[]): Op[] {
  const byId = new Map<ID, Op>();
  for (const op of local) byId.set(op.id, op);
  for (const op of remote) {
    const existing = byId.get(op.id);
    // A remote copy carrying a server sequence supersedes an unacknowledged local one.
    if (!existing || (existing.serverSeq == null && op.serverSeq != null)) {
      byId.set(op.id, op);
    }
  }
  return [...byId.values()].sort(compareOps);
}

/** Ops still awaiting upload, in the order they should be sent. */
export function pendingOps(ops: readonly Op[]): Op[] {
  return ops.filter((o) => o.synced === 0).sort(compareOps);
}

export function highestServerSeq(ops: readonly Op[]): number {
  let max = 0;
  for (const o of ops) if (o.serverSeq != null && o.serverSeq > max) max = o.serverSeq;
  return max;
}

export function highestLamport(ops: readonly Op[]): number {
  let max = 0;
  for (const o of ops) if (o.lamport > max) max = o.lamport;
  return max;
}

// ---------------------------------------------------------------------------
// Diffing, for the audit trail
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  amount: 'Amount',
  date: 'Date',
  merchant: 'Merchant',
  notes: 'Notes',
  tags: 'Tags',
  name: 'Name',
  categoryId: 'Category',
  accountId: 'Account',
  limit: 'Limit',
  targetAmount: 'Target',
  targetDate: 'Target date',
  dueDate: 'Due date',
  currency: 'Currency',
  kind: 'Type',
  time: 'Time',
  archived: 'Archived',
  parentId: 'Parent category',
  creditLimit: 'Credit limit',
  interval: 'Interval',
  frequency: 'Frequency',
  plannedContribution: 'Planned contribution',
  ratePerTrip: 'Rate per trip',
  riderIds: 'Riders',
  settleAs: 'Records as',
  settleCategoryId: 'Category',
  active: 'Active',
};

const MONEY_FIELDS = new Set([
  'amount', 'limit', 'targetAmount', 'creditLimit', 'plannedContribution', 'principal',
  'ratePerTrip',
]);

/** Fields that are storage bookkeeping rather than user-meaningful history. */
const IGNORED_FIELDS = new Set(['updatedAt', 'createdAt', 'id', 'postings', 'accountIds']);

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (a == null && b == null) return true;
  return false;
}

/** Compute a user-meaningful field diff between two versions of an entity. */
export function diffEntity<T extends object>(
  before: T,
  after: T,
  extraLabels: Record<string, string> = {},
): FieldChange[] {
  const changes: FieldChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    const b = (before as Record<string, unknown>)[key];
    const a = (after as Record<string, unknown>)[key];
    if (sameValue(b, a)) continue;
    changes.push({
      field: key,
      label: extraLabels[key] ?? FIELD_LABELS[key] ?? key,
      before: b,
      after: a,
      money: MONEY_FIELDS.has(key),
    });
  }
  return changes;
}

/** All ops that touched one entity, oldest first — the entity's own history. */
export function historyFor(ops: readonly Op[], entityId: ID): Op[] {
  return ops.filter((o) => o.entityId === entityId).sort(compareOps);
}
