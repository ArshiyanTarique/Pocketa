/**
 * Local persistence.
 *
 * IndexedDB (via Dexie) is the durable working copy. The app reads from memory
 * and writes through to here, so it is fully usable with no network at all —
 * Supabase, when connected, is a sync target rather than the read path.
 *
 * Each signed-in account gets its own database namespace, so two people sharing
 * a device never see each other's ledger, and signing out leaves nothing behind
 * in the active session.
 */

import Dexie, { type Table } from 'dexie';
import type {
  Account,
  Carpool,
  CarpoolRider,
  CarpoolSettlement,
  CarpoolTrip,
  Attachment,
  Budget,
  Debt,
  Goal,
  ImportBatch,
  OccurrenceOverride,
  Person,
  Recurrence,
  Settings,
  Transaction,
} from '../core/types';
import type { Op } from './oplog';
import type { EncodedAttachment } from './attachments';

/** Bookkeeping that is local to this device and never synced. */
export interface DeviceMeta {
  key: string;
  value: unknown;
}

export class PocketaDB extends Dexie {
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  budgets!: Table<Budget, string>;
  recurrences!: Table<Recurrence, string>;
  overrides!: Table<OccurrenceOverride, string>;
  goals!: Table<Goal, string>;
  debts!: Table<Debt, string>;
  people!: Table<Person, string>;
  attachments!: Table<Attachment, string>;
  imports!: Table<ImportBatch, string>;
  settings!: Table<Settings, string>;
  carpools!: Table<Carpool, string>;
  carpoolRiders!: Table<CarpoolRider, string>;
  carpoolTrips!: Table<CarpoolTrip, string>;
  carpoolSettlements!: Table<CarpoolSettlement, string>;
  ops!: Table<Op, string>;
  meta!: Table<DeviceMeta, string>;

  constructor(namespace: string) {
    super(`pocketa_${namespace}`);
    this.version(1).stores({
      accounts: 'id, class, parentId, archived, sortOrder',
      transactions: 'id, date, kind, voided, merchant, linkedTxnId, recurrenceId, occurrenceKey, importBatchId, dedupeHash, *tags',
      budgets: 'id, archived, period',
      recurrences: 'id, archived, kind, startDate, isBill',
      overrides: 'id, recurrenceId, dueDate, status, [recurrenceId+dueDate]',
      goals: 'id, archived, accountId, targetDate',
      debts: 'id, personId, direction, settled, dueDate',
      people: 'id, name, archived',
      attachments: 'id, txnId',
      imports: 'id, createdAt',
      settings: 'id',
      ops: 'id, entityId, entity, type, createdAt, synced, serverSeq, lamport',
      meta: 'key',
    });

    // v2 adds the carpool tally. Dexie migrates existing data untouched: new
    // stores are created and every other table is left exactly as it was.
    this.version(2).stores({
      carpools: 'id, archived',
      carpoolRiders: 'id, carpoolId, personId, active',
      carpoolTrips: 'id, carpoolId, date, settlementId, *riderIds',
      carpoolSettlements: 'id, carpoolId, createdAt',
    });

    /**
     * v3: the index set now matches how the data is actually read.
     *
     * Two changes, both about honesty.
     *
     * **Indexes that nothing queries are gone.** This app loads each table into
     * memory once and filters there — a personal ledger is small enough that
     * this is the right trade — so an index was never read, only maintained.
     * The multi-entry `*tags` index was the worst of them: one entry per tag
     * per transaction, written on every save, read by nothing. What remains
     * are the accesses that are real or imminent: a date range, the bin, the
     * duplicate check an import runs, a transaction's receipts, and the two
     * questions the op log is actually asked.
     *
     * **A real constraint replaces a decorative one.** `[recurrenceId+dueDate]`
     * was a plain compound index; it is now unique. One override per
     * occurrence is a rule the app depends on — without it the same bill can be
     * recorded as both paid and skipped — and a rule enforced by the store
     * cannot be broken by a bad merge, a race, or a hand-edited backup.
     */
    this.version(3)
      .stores({
        accounts: 'id',
        transactions: 'id, date, voided, dedupeHash',
        budgets: 'id',
        recurrences: 'id',
        overrides: 'id, recurrenceId, &[recurrenceId+dueDate]',
        goals: 'id',
        debts: 'id',
        people: 'id',
        attachments: 'id, txnId',
        imports: 'id',
        ops: 'id, entityId, synced',
        carpools: 'id',
        carpoolRiders: 'id, carpoolId',
        carpoolTrips: 'id, carpoolId, settlementId',
        carpoolSettlements: 'id',
      })
      .upgrade(async (tx) => {
        // The unique index cannot be created over data that already violates
        // it, and a duplicate override is exactly the corruption it exists to
        // stop. Keep the most recently updated of each pair.
        const rows = await tx.table('overrides').toArray();
        const newest = new Map<string, { id: string; updatedAt: string }>();
        const doomed: string[] = [];

        for (const row of rows as Array<{ id: string; recurrenceId: string; dueDate: string; updatedAt: string }>) {
          const key = `${row.recurrenceId}:${row.dueDate}`;
          const held = newest.get(key);
          if (!held) {
            newest.set(key, row);
          } else if ((row.updatedAt ?? '') > (held.updatedAt ?? '')) {
            doomed.push(held.id);
            newest.set(key, row);
          } else {
            doomed.push(row.id);
          }
        }

        if (doomed.length) await tx.table('overrides').bulkDelete(doomed);
      });
  }
}

/** Namespace for data that has not been attached to a signed-in account. */
export const LOCAL_NAMESPACE = 'local';

let current: PocketaDB | null = null;
let currentNamespace: string | null = null;

export function getDb(namespace: string = LOCAL_NAMESPACE): PocketaDB {
  if (current && currentNamespace === namespace) return current;
  if (current) current.close();
  current = new PocketaDB(namespace);
  currentNamespace = namespace;
  return current;
}

export function activeNamespace(): string {
  return currentNamespace ?? LOCAL_NAMESPACE;
}

/** Turn a Supabase user id into a stable, filesystem-safe namespace. */
export function namespaceForUser(userId: string | null | undefined): string {
  if (!userId) return LOCAL_NAMESPACE;
  return `u_${userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}`;
}

/**
 * A complete, self-describing snapshot of one ledger. This is the JSON backup
 * format and the payload a restore consumes.
 */
export interface Snapshot {
  format: 'pocketa.snapshot';
  version: 1;
  exportedAt: string;
  namespace: string;
  counts: Record<string, number>;
  data: {
    accounts: Account[];
    transactions: Transaction[];
    budgets: Budget[];
    recurrences: Recurrence[];
    overrides: OccurrenceOverride[];
    goals: Goal[];
    debts: Debt[];
    people: Person[];
    imports: ImportBatch[];
    carpools: Carpool[];
    carpoolRiders: CarpoolRider[];
    carpoolTrips: CarpoolTrip[];
    carpoolSettlements: CarpoolSettlement[];
    settings: Settings[];
    ops: Op[];
    /**
     * Receipts, base64-encoded. Optional: a backup taken without them restores
     * everything else and simply has no files, which the restore screen says.
     */
    attachments?: EncodedAttachment[];
  };
}

const SNAPSHOT_TABLES = [
  'accounts', 'transactions', 'budgets', 'recurrences', 'overrides',
  'goals', 'debts', 'people', 'imports', 'settings', 'ops',
  'carpools', 'carpoolRiders', 'carpoolTrips', 'carpoolSettlements',
] as const;

export async function exportSnapshot(db: PocketaDB): Promise<Snapshot> {
  const data = {} as Snapshot['data'];
  const counts: Record<string, number> = {};
  for (const name of SNAPSHOT_TABLES) {
    const rows = await (db[name] as unknown as Table<unknown, string>).toArray();
    (data as unknown as Record<string, unknown[]>)[name] = rows;
    counts[name] = rows.length;
  }
  return {
    format: 'pocketa.snapshot',
    version: 1,
    exportedAt: new Date().toISOString(),
    namespace: activeNamespace(),
    counts,
    data,
  };
}

export interface RestoreReport {
  ok: boolean;
  counts: Record<string, number>;
  error?: string;
}

export function validateSnapshot(value: unknown): { ok: true; snapshot: Snapshot } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'That file is not a Pocketa backup.' };
  const s = value as Partial<Snapshot>;
  if (s.format !== 'pocketa.snapshot') {
    return { ok: false, error: 'That file is not a Pocketa backup.' };
  }
  if (s.version !== 1) {
    return { ok: false, error: `This backup was made by a newer version of Pocketa (format ${String(s.version)}).` };
  }
  if (!s.data || typeof s.data !== 'object') {
    return { ok: false, error: 'This backup is missing its data.' };
  }
  if (!Array.isArray(s.data.accounts) || !Array.isArray(s.data.transactions)) {
    return { ok: false, error: 'This backup is incomplete or damaged.' };
  }
  return { ok: true, snapshot: s as Snapshot };
}

/**
 * Replace the entire contents of the database with a snapshot.
 *
 * DESTRUCTIVE. The caller must have confirmed with the user first — the UI
 * shows what will be erased and requires an explicit typed confirmation before
 * this is ever reached.
 */
export async function restoreSnapshot(db: PocketaDB, snapshot: Snapshot): Promise<RestoreReport> {
  const tables = SNAPSHOT_TABLES.map((n) => db[n] as unknown as Table<unknown, string>);
  try {
    await db.transaction('rw', tables, async () => {
      for (const name of SNAPSHOT_TABLES) {
        const table = db[name] as unknown as Table<unknown, string>;
        await table.clear();
        const rows = (snapshot.data as unknown as Record<string, unknown[]>)[name] ?? [];
        if (rows.length) await table.bulkPut(rows);
      }
    });
    return { ok: true, counts: snapshot.counts ?? {} };
  } catch (err) {
    return {
      ok: false,
      counts: {},
      error: err instanceof Error ? err.message : 'The restore could not be completed.',
    };
  }
}

/**
 * Carry a device's offline ledger into an account, the first time one is made.
 *
 * Without this, signing in is indistinguishable from losing everything. The
 * anonymous ledger lives in the `local` namespace; an account gets its own. So
 * somebody who used the app for a month and then created an account would sign
 * in and find an empty ledger — their data still on the device, but nowhere
 * they could see it.
 *
 * Only ever runs when the account is brand new and the device has something to
 * give it. The local copy is left exactly where it is: this is a copy, not a
 * move, so a mistake here costs nothing.
 *
 * The op log comes too, which is what makes the adopted history sync to the
 * server on the first connection rather than starting from the sign-in date.
 */
export async function adoptLocalLedger(targetNamespace: string): Promise<number> {
  if (targetNamespace === LOCAL_NAMESPACE) return 0;

  const source = new PocketaDB(LOCAL_NAMESPACE);
  const target = new PocketaDB(targetNamespace);
  try {
    await source.open();
    await target.open();

    // Already done once for this device — a second account signing in on the
    // same phone must not inherit the first person's ledger.
    if (await source.meta.get(ADOPTED_KEY)) return 0;

    // Nothing worth carrying, or the account is not empty after all.
    const [sourceTxns, targetTxns, targetOps] = await Promise.all([
      source.transactions.count(),
      target.transactions.count(),
      target.ops.count(),
    ]);
    if (sourceTxns === 0) return 0;
    if (targetTxns > 0 || targetOps > 0) return 0;

    const tables = [...SNAPSHOT_TABLES, 'attachments'] as const;
    let copied = 0;

    for (const name of tables) {
      const rows = await (source[name] as unknown as Table<unknown, string>).toArray();
      if (!rows.length) continue;
      await target.transaction('rw', target[name] as unknown as Table<unknown, string>, async () => {
        await (target[name] as unknown as Table<unknown, string>).bulkPut(rows);
      });
      copied += rows.length;
    }

    await source.meta.put({ key: ADOPTED_KEY, value: { namespace: targetNamespace, at: new Date().toISOString() } });
    return copied;
  } finally {
    source.close();
    target.close();
  }
}

/** Marks the device's local ledger as already carried into an account. */
const ADOPTED_KEY = 'adoptedIntoAccount';

/** Erase everything in the active namespace. Used by "start over". */
export async function wipe(db: PocketaDB): Promise<void> {
  const tables = [...SNAPSHOT_TABLES, 'attachments', 'meta'] as const;
  await db.transaction(
    'rw',
    tables.map((n) => db[n] as unknown as Table<unknown, string>),
    async () => {
      for (const name of tables) {
        await (db[name] as unknown as Table<unknown, string>).clear();
      }
    },
  );
}
