/**
 * The application store.
 *
 * The whole ledger lives in memory — a personal finance dataset is small enough
 * that loading it entirely makes every projection instant and every screen
 * usable offline. IndexedDB is written through on each mutation, so the memory
 * copy and the durable copy never diverge.
 *
 * Every mutation does two things together: it updates the entity, and it
 * appends an op describing the change. Nothing writes one without the other.
 */

import { create } from 'zustand';
import { nowIso, today } from '../core/dates';
import { newId } from '../core/ids';
import { buildFromDraft, draftFromTransaction, type TxnDraft } from '../core/draft';
import {
  restoreTransaction as restoreTxnEntity,
  validateTransaction,
  voidTransaction as voidTxnEntity,
  type Issue,
  type LedgerContext,
  type Result,
} from '../core/ledger';
import type {
  Account,
  Attachment,
  Carpool,
  CarpoolRider,
  CarpoolSettlement,
  CarpoolSettlementLine,
  CarpoolTrip,
  Budget,
  Debt,
  Goal,
  ID,
  ImportBatch,
  OccurrenceOverride,
  Person,
  Recurrence,
  Settings,
  Transaction,
} from '../core/types';
import {
  adoptLocalLedger,
  exportSnapshot,
  getDb,
  namespaceForUser,
  restoreSnapshot,
  validateSnapshot,
  wipe,
  type PocketaDB,
  type Snapshot,
} from '../data/db';
import {
  compareOps,
  diffEntity,
  highestLamport,
  makeOp,
  type FieldChange,
  type Op,
  type OpType,
  type EntityKind,
} from '../data/oplog';
import { buildSeed, findCategoryByName, SYSTEM_ADJUSTMENT_ID, SYSTEM_OPENING_ID } from '../data/seed';
import { buildOccurrences } from '../core/recurrence';
import { buildCarpoolSettlement } from '../core/ledger';
import { tripsToSettle } from '../core/carpool';
import type { DateRange } from '../core/dates';
import { checkIntegrity, repairDataset, summariseIssues, type Dataset } from '../data/integrity';
import {
  prepareAttachment,
  encodeAttachment,
  decodeAttachment,
  totalBytes,
} from '../data/attachments';

export type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface StoreState {
  status: Status;
  error: string | null;
  namespace: string;

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
  attachments: Attachment[];
  ops: Op[];
  settings: Settings;

  /** Bumped whenever an op is appended; sync watches this. */
  revision: number;
}

export interface StoreActions {
  init(namespace?: string): Promise<void>;
  /** Returns how many rows were carried in from the device's offline ledger. */
  switchAccount(userId: string | null): Promise<number>;

  ledgerContext(): LedgerContext;
  accountMap(): Map<ID, Account>;

  createTransaction(draft: TxnDraft): Promise<Result<Transaction>>;
  createTransactions(drafts: TxnDraft[], batch?: ImportBatch): Promise<{ created: Transaction[]; failed: Array<{ draft: TxnDraft; issues: Issue[] }> }>;
  updateTransaction(id: ID, draft: TxnDraft): Promise<Result<Transaction>>;
  voidTransaction(id: ID): Promise<void>;
  restoreTransaction(id: ID): Promise<void>;
  purgeVoided(): Promise<number>;

  saveAccount(account: Account, isNew?: boolean): Promise<void>;
  archiveAccount(id: ID, archived: boolean): Promise<void>;
  reorderAccounts(ids: ID[]): Promise<void>;

  saveBudget(budget: Budget, isNew?: boolean): Promise<void>;
  archiveBudget(id: ID, archived: boolean): Promise<void>;

  saveRecurrence(rec: Recurrence, isNew?: boolean): Promise<void>;
  archiveRecurrence(id: ID, archived: boolean): Promise<void>;
  setOccurrence(override: OccurrenceOverride): Promise<void>;
  clearOccurrence(recurrenceId: ID, dueDate: string): Promise<void>;

  saveGoal(goal: Goal, isNew?: boolean): Promise<void>;
  archiveGoal(id: ID, archived: boolean): Promise<void>;

  saveDebt(debt: Debt, isNew?: boolean): Promise<void>;
  savePerson(person: Person, isNew?: boolean): Promise<void>;
  /**
   * A new person and both of their accounts, in one transaction. Returns the
   * ids, so a caller can point a debt at them straight away.
   */
  addPerson(name: string, contact?: string | null): Promise<{ personId: ID; receivableId: ID; payableId: ID }>;

  updateSettings(patch: Partial<Settings>): Promise<void>;

  exportBackup(includeAttachments?: boolean): Promise<Snapshot>;
  restoreBackup(raw: unknown): Promise<{ ok: boolean; error?: string }>;
  resetEverything(): Promise<void>;

  markOpsSynced(ids: ID[], seqByopId: Record<ID, number>): Promise<void>;
  ingestRemoteOps(ops: Op[]): Promise<void>;

  addAttachment(file: File, txnId: ID | null): Promise<{ ok: boolean; id?: ID; error?: string }>;
  linkAttachments(txnId: ID, attachmentIds: ID[]): Promise<void>;
  removeAttachment(id: ID): Promise<void>;

  saveCarpool(carpool: Carpool, isNew?: boolean): Promise<void>;
  saveCarpoolRider(rider: CarpoolRider, isNew?: boolean): Promise<void>;
  logTrip(trip: CarpoolTrip, isNew?: boolean): Promise<void>;
  deleteTrip(id: ID): Promise<void>;
  settleCarpool(
    carpoolId: ID,
    range: DateRange,
    lines: CarpoolSettlementLine[],
  ): Promise<{ ok: boolean; settlement?: CarpoolSettlement; error?: string }>;

  runAutoPost(): Promise<{ posted: Array<{ name: string; amount: number; date: string; txnId: ID }> }>;

  loadSampleData(): Promise<{ ok: boolean; created: number; failed: number }>;
}

export type Store = StoreState & StoreActions;

const EMPTY_SETTINGS: Settings = {
  id: 'settings',
  baseCurrency: 'PKR',
  fxRates: {},
  fxUpdatedAt: null,
  theme: 'system',
  weekStartsOn: 1,
  monthStartDay: 1,
  safeToSpendHorizon: 30,
  safeToSpendReserveGoals: true,
  hideAmounts: false,
  onboarded: false,
  deviceId: 'unknown',
  createdAt: nowIso(),
  updatedAt: nowIso(),
};

// ---------------------------------------------------------------------------
// Op bookkeeping
// ---------------------------------------------------------------------------

const opState = { deviceId: 'unknown', lamport: 0 };

/** In-flight boots, keyed by namespace, so a namespace is only ever seeded once. */
const bootInFlight = new Map<string, Promise<void>>();

const PERSISTENCE_ASKED = 'persistenceRequested';

/**
 * Is the entity a peer sent us safe to write?
 *
 * Checked in isolation, because a pulled op arrives without the rest of the
 * data it refers to — the accounts it points at may only arrive in a later
 * page. So this asks the questions that can be answered from the row alone:
 * is it the right shape, is every amount a whole number of paisa, does a
 * transaction balance. Cross-row references are checked by the audit that the
 * user can run over the whole ledger.
 */
function acceptableSnapshot(op: Op): boolean {
  const row = op.snapshot as Record<string, unknown> | null;
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) return false;

  if (op.entity === 'transaction') {
    const txn = row as unknown as Transaction;
    if (!Array.isArray(txn.postings) || txn.postings.length < 2) return false;
    let sum = 0;
    let baseSum = 0;
    for (const posting of txn.postings) {
      if (!Number.isSafeInteger(posting.amount) || !Number.isSafeInteger(posting.baseAmount)) return false;
      if (!posting.accountId) return false;
      sum += posting.amount;
      baseSum += posting.baseAmount;
    }
    // The invariant holds on the wire too, or the row is not a transaction.
    return sum === 0 && baseSum === 0;
  }

  const money = ['amount', 'limit', 'targetAmount', 'principal', 'ratePerTrip', 'creditLimit'];
  for (const field of money) {
    const value = row[field];
    if (value != null && (typeof value !== 'number' || !Number.isSafeInteger(value))) return false;
  }
  return true;
}

/**
 * Ask the browser once not to evict this origin.
 *
 * Best-effort by design: Chrome decides on engagement and never prompts,
 * Firefox asks the user, Safari grants it to an installed app. Whatever the
 * answer, it is recorded so nobody is asked twice.
 */
async function ensurePersistentStorage(database: PocketaDB): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    if (await navigator.storage.persisted?.()) return;
    if (await database.meta.get(PERSISTENCE_ASKED)) return;
    await database.meta.put({ key: PERSISTENCE_ASKED, value: true });
    await navigator.storage.persist();
  } catch {
    // A browser that refuses to answer is not a reason to fail a boot.
  }
}

function db(): PocketaDB {
  return getDb(useStore.getState().namespace);
}

interface CommitInput {
  type: OpType;
  entity: EntityKind;
  entityId: ID;
  summary: string;
  changes?: FieldChange[] | null;
  snapshot?: unknown;
}

export interface CommitSpec {
  /**
   * The durable change. Runs inside the transaction, so anything it writes
   * lands with the op that describes it.
   */
  write?(database: PocketaDB): Promise<unknown> | unknown;
  /** What happened, for history and for sync. One op, or several. */
  log?: CommitInput | CommitInput[];
  /** The in-memory update. Applied only once the write has committed. */
  apply?(state: StoreState): Partial<StoreState>;
}

/**
 * One mutation. Every write in the app goes through here.
 *
 * Two guarantees, and both used to be missing:
 *
 *   **Atomic.** The change and the record of it are written in a single
 *   IndexedDB transaction. Before this they were two, so a tab closed in the
 *   gap left a transaction with no audit entry — invisible in history, and
 *   never pushed to another device, because the op is the unit of sync.
 *
 *   **Durable before visible.** Memory is updated only after the transaction
 *   commits. Before this the screen was updated first, so a write that failed
 *   (quota exhausted, storage evicted) still showed the user a saved figure.
 *
 * IndexedDB gives isolation for free here: transactions on the same tables are
 * serialised, so two mutations racing cannot interleave.
 */
async function commit(spec: CommitSpec): Promise<Op[]> {
  const database = db();
  const inputs = spec.log == null ? [] : Array.isArray(spec.log) ? spec.log : [spec.log];

  // Stamped before the transaction so ordering follows the order mutations were
  // issued. A failed transaction leaves a gap in the sequence, which is
  // harmless: a Lamport clock only has to increase, never be dense.
  const ops = inputs.map((input) => makeOp(opState, input));

  await database.transaction('rw', database.tables, async () => {
    if (spec.write) await spec.write(database);
    if (ops.length) await database.ops.bulkPut(ops);
  });

  useStore.setState((s) => ({
    ...(spec.apply ? spec.apply(s) : {}),
    ops: ops.length ? [...s.ops, ...ops] : s.ops,
    revision: s.revision + ops.length,
  }));
  return ops;
}

function upsert<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  if (i === -1) return [...list, row];
  const next = list.slice();
  next[i] = row;
  return next;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create<Store>()((set, get) => ({
  status: 'idle',
  error: null,
  namespace: 'local',
  accounts: [],
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
  attachments: [],
  ops: [],
  settings: EMPTY_SETTINGS,
  revision: 0,

  // -------------------------------------------------------------------------

  async init(namespace = 'local') {
    // Two callers can race here — React re-invokes effects in development, and
    // signing in switches namespace while a boot may still be in flight. Without
    // this guard both would seed the defaults and the user would end up with two
    // of every category.
    const inFlight = bootInFlight.get(namespace);
    if (inFlight) return inFlight;

    const run = (async () => {
      set({ status: 'loading', error: null, namespace });
      try {
        const database = getDb(namespace);

        // The check and the write share one transaction, so a concurrent boot
        // that slips past the guard still sees the seed already committed.
        const settings = await database.transaction(
          'rw',
          database.accounts,
          database.settings,
          async () => {
            const existing = await database.settings.get('settings');
            if (existing) return existing;

            const deviceId = localStorage.getItem('pocketa.deviceId') ?? newId('dev');
            localStorage.setItem('pocketa.deviceId', deviceId);
            const seed = buildSeed(deviceId);
            await database.accounts.bulkPut(seed.accounts);
            await database.settings.put(seed.settings);
            return seed.settings;
          },
        );

        const [accounts, transactions, budgets, recurrences, overrides, goals, debts, people, imports, ops,
               carpools, carpoolRiders, carpoolTrips, carpoolSettlements, attachments] =
          await Promise.all([
            database.accounts.toArray(),
            database.transactions.toArray(),
            database.budgets.toArray(),
            database.recurrences.toArray(),
            database.overrides.toArray(),
            database.goals.toArray(),
            database.debts.toArray(),
            database.people.toArray(),
            database.imports.toArray(),
            database.ops.toArray(),
            database.carpools.toArray(),
            database.carpoolRiders.toArray(),
            database.carpoolTrips.toArray(),
            database.carpoolSettlements.toArray(),
            database.attachments.toArray(),
          ]);

        opState.deviceId = settings.deviceId;
        opState.lamport = highestLamport(ops);

        // Durability is only as good as the browser's willingness to keep the
        // data. An origin that is not marked persistent can be evicted under
        // storage pressure, which for a ledger means losing months of entries.
        // Asked once, at the first moment there is something worth keeping, and
        // never again — Settings has the explicit control for anyone who
        // declines. Not awaited: it must never delay a boot.
        if (transactions.length > 0) void ensurePersistentStorage(database);

        // IndexedDB returns rows in key order, and an op id is random — so
        // without this the log came back shuffled after every restart. Sorting
        // once here means the array is canonically ordered everywhere, rather
        // than every reader having to remember to sort it.
        ops.sort(compareOps);

        set({
          status: 'ready',
          accounts,
          transactions,
          budgets,
          recurrences,
          overrides,
          goals,
          debts,
          people,
          imports,
          carpools,
          carpoolRiders,
          carpoolTrips,
          carpoolSettlements,
          attachments,
          ops,
          settings,
        });
      } catch (err) {
        set({
          status: 'error',
          error:
            err instanceof Error
              ? `Pocketa could not open your data: ${err.message}`
              : 'Pocketa could not open your data.',
        });
      } finally {
        bootInFlight.delete(namespace);
      }
    })();

    bootInFlight.set(namespace, run);
    return run;
  },

  async switchAccount(userId) {
    const namespace = namespaceForUser(userId);

    // Signing in for the first time must not look like losing everything. An
    // account has its own namespace, so without this the ledger someone built
    // offline would still be on the device but nowhere they could see it.
    let adopted = 0;
    if (userId) {
      try {
        adopted = await adoptLocalLedger(namespace);
      } catch {
        // A failed adoption is not a reason to fail a sign-in: the local ledger
        // is untouched and still there when they sign out.
      }
    }

    // The boot guard keys on namespace, so a namespace that was reached once
    // while empty would otherwise never be re-read after adoption.
    if (adopted > 0) bootInFlight.delete(namespace);
    await get().init(namespace);
    return adopted;
  },

  // -------------------------------------------------------------------------

  accountMap() {
    return new Map(get().accounts.map((a) => [a.id, a]));
  },

  ledgerContext() {
    const s = get();
    return {
      accounts: new Map(s.accounts.map((a) => [a.id, a])),
      baseCurrency: s.settings.baseCurrency,
      fxRates: s.settings.fxRates,
    };
  },

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  async createTransaction(draft) {
    const built = buildFromDraft(draft, get().ledgerContext());
    if (!built.ok) return built;

    const txn = built.value;
    await commit({
      write: (d) => d.transactions.put(txn),
      apply: (s) => ({ transactions: [...s.transactions, txn] }),
      log: {
        type: 'txn.created',
        entity: 'transaction',
        entityId: txn.id,
        summary: describeTxn(txn, get().accountMap()),
        snapshot: txn,
      },
    });
    return built;
  },

  async createTransactions(drafts, batch) {
    const created: Transaction[] = [];
    const failed: Array<{ draft: TxnDraft; issues: Issue[] }> = [];
    const ctx = get().ledgerContext();

    for (const draft of drafts) {
      const built = buildFromDraft(draft, ctx);
      if (built.ok) created.push(built.value);
      else failed.push({ draft, issues: built.issues });
    }

    // An import is one transaction, not one per row: a partially written batch
    // is the failure mode the whole feature exists to avoid.
    const record: ImportBatch | null = batch
      ? { ...batch, importedCount: created.length, skippedCount: failed.length }
      : null;
    const accounts = get().accountMap();

    if (created.length > 0 || record) {
      await commit({
        write: async (d) => {
          if (created.length > 0) await d.transactions.bulkPut(created);
          if (record) await d.imports.put(record);
        },
        apply: (s) => ({
          transactions: created.length > 0 ? [...s.transactions, ...created] : s.transactions,
          imports: record ? [...s.imports, record] : s.imports,
        }),
        log: record
          ? {
              type: 'import.committed',
              entity: 'import',
              entityId: record.id,
              summary: `Imported ${created.length} transaction${created.length === 1 ? '' : 's'} from ${record.fileName}`,
              snapshot: record,
            }
          : created.map((txn) => ({
              type: 'txn.created' as const,
              entity: 'transaction' as const,
              entityId: txn.id,
              summary: describeTxn(txn, accounts),
              snapshot: txn,
            })),
      });
    }
    return { created, failed };
  },

  async updateTransaction(id, draft) {
    const before = get().transactions.find((t) => t.id === id);
    if (!before) {
      return { ok: false, issues: [{ code: 'not_found', message: 'That transaction no longer exists.' }] };
    }

    // Rebuild from the draft so the edit is subject to the same invariants as
    // a fresh entry, then re-validate before anything is written.
    const rebuilt = buildFromDraft({ ...draft, id, createdAt: before.createdAt }, get().ledgerContext());
    if (!rebuilt.ok) return rebuilt;

    const after: Transaction = { ...rebuilt.value, id, createdAt: before.createdAt, updatedAt: nowIso() };
    const check = validateTransaction(after, get().ledgerContext());
    if (!check.ok) return check;

    const changes = summariseTxnChanges(before, after, get().accountMap());

    await commit({
      write: (d) => d.transactions.put(after),
      apply: (s) => ({ transactions: s.transactions.map((t) => (t.id === id ? after : t)) }),
      log: {
        type: 'txn.amended',
        entity: 'transaction',
        entityId: id,
        summary: changes.length ? `Edited ${describeTxn(after, get().accountMap())}` : 'Edited transaction',
        changes,
        snapshot: after,
        },
    });
    return { ok: true, value: after };
  },

  async voidTransaction(id) {
    const txn = get().transactions.find((t) => t.id === id);
    if (!txn || txn.voided) return;
    const voided = voidTxnEntity(txn, nowIso());
    await commit({
      write: (d) => d.transactions.put(voided),
      apply: (s) => ({ transactions: s.transactions.map((t) => (t.id === id ? voided : t)) }),
      log: {
        type: 'txn.voided',
        entity: 'transaction',
        entityId: id,
        summary: `Deleted ${describeTxn(txn, get().accountMap())}`,
        snapshot: voided,
      },
    });
  },

  async restoreTransaction(id) {
    const txn = get().transactions.find((t) => t.id === id);
    if (!txn || !txn.voided) return;
    const restored = restoreTxnEntity(txn, nowIso());
    await commit({
      write: (d) => d.transactions.put(restored),
      apply: (s) => ({ transactions: s.transactions.map((t) => (t.id === id ? restored : t)) }),
      log: {
        type: 'txn.restored',
        entity: 'transaction',
        entityId: id,
        summary: `Restored ${describeTxn(txn, get().accountMap())}`,
        snapshot: restored,
      },
    });
  },

  async purgeVoided() {
    const state = get();
    const voided = state.transactions.filter((t) => t.voided);
    if (voided.length === 0) return 0;

    // A relational database would answer this with ON DELETE — either refusing
    // the delete or cascading it. IndexedDB will simply remove the row and
    // leave every reference to it pointing at nothing, so the referents are
    // gathered up and cleared in the same transaction.
    const doomed = new Set(voided.map((t) => t.id));
    const ids = [...doomed];

    const refunds = state.transactions
      .filter((t) => !doomed.has(t.id) && t.linkedTxnId && doomed.has(t.linkedTxnId))
      .map((t) => ({ ...t, linkedTxnId: null, updatedAt: nowIso() }));

    const overrides = state.overrides
      .filter((o) => o.txnId && doomed.has(o.txnId))
      .map((o) => ({ ...o, txnId: null, status: 'upcoming' as const, updatedAt: nowIso() }));

    const attachments = state.attachments
      .filter((a) => a.txnId && doomed.has(a.txnId))
      .map((a) => a.id);

    // The only permanent delete in the app, so it is the one that most needs a
    // record. Emptying the bin must not itself be invisible.
    await commit({
      write: async (d) => {
        await d.transactions.bulkDelete(ids);
        if (refunds.length) await d.transactions.bulkPut(refunds);
        if (overrides.length) await d.overrides.bulkPut(overrides);
        // A receipt for a transaction that no longer exists is a file nobody
        // can reach, silently holding on to the storage cap.
        if (attachments.length) await d.attachments.bulkDelete(attachments);
      },
      apply: (s) => ({
        transactions: s.transactions
          .filter((t) => !doomed.has(t.id))
          .map((t) => refunds.find((r) => r.id === t.id) ?? t),
        overrides: s.overrides.map((o) => overrides.find((x) => x.id === o.id) ?? o),
        attachments: s.attachments.filter((a) => !attachments.includes(a.id)),
      }),
      log: {
        type: 'data.purged',
        entity: 'transaction',
        entityId: ids[0],
        summary: `Permanently removed ${voided.length} deleted transaction${voided.length === 1 ? '' : 's'}`,
        snapshot: { ids, clearedRefunds: refunds.length, clearedBills: overrides.length, removedReceipts: attachments.length },
      },
    });
    return voided.length;
  },

  // -------------------------------------------------------------------------
  // Accounts and categories
  // -------------------------------------------------------------------------

  async saveAccount(account, isNew = false) {
    const before = get().accounts.find((a) => a.id === account.id);
    const row: Account = { ...account, updatedAt: nowIso() };
    const isCategory = row.class === 'expense_category' || row.class === 'income_category';

    await commit({
      write: (d) => d.accounts.put(row),
      apply: (s) => ({ accounts: upsert(s.accounts, row) }),
      log: {
        type: isNew || !before
          ? isCategory ? 'category.created' : 'account.created'
          : isCategory ? 'category.amended' : 'account.amended',
        entity: 'account',
        entityId: row.id,
        summary: isNew || !before ? `Created ${row.name}` : `Edited ${row.name}`,
        changes: before ? diffEntity(before, row) : null,
        snapshot: row,
      },
    });
  },

  async archiveAccount(id, archived) {
    const account = get().accounts.find((a) => a.id === id);
    if (!account || account.system) return;
    const row: Account = {
      ...account,
      archived,
      archivedAt: archived ? nowIso() : null,
      updatedAt: nowIso(),
    };
    const isCategory = row.class === 'expense_category' || row.class === 'income_category';

    await commit({
      write: (d) => d.accounts.put(row),
      apply: (s) => ({ accounts: upsert(s.accounts, row) }),
      log: {
        type: isCategory ? 'category.archived' : archived ? 'account.archived' : 'account.unarchived',
        entity: 'account',
        entityId: id,
        // Archiving never touches history: existing transactions keep pointing here.
        summary: archived ? `Archived ${row.name}` : `Restored ${row.name}`,
        snapshot: row,
      },
    });
  },

  async reorderAccounts(ids) {
    const map = new Map(get().accounts.map((a) => [a.id, a]));
    const updated: Account[] = [];
    ids.forEach((id, i) => {
      const a = map.get(id);
      if (a && a.sortOrder !== i) updated.push({ ...a, sortOrder: i, updatedAt: nowIso() });
    });
    if (updated.length === 0) return;
    await db().accounts.bulkPut(updated);
    set((s) => ({ accounts: s.accounts.map((a) => updated.find((u) => u.id === a.id) ?? a) }));
  },

  // -------------------------------------------------------------------------
  // Budgets
  // -------------------------------------------------------------------------

  async saveBudget(budget, isNew = false) {
    const before = get().budgets.find((b) => b.id === budget.id);
    const row: Budget = { ...budget, updatedAt: nowIso() };
    await commit({
      write: (d) => d.budgets.put(row),
      apply: (s) => ({ budgets: upsert(s.budgets, row) }),
      log: {
        type: isNew || !before ? 'budget.created' : 'budget.amended',
        entity: 'budget',
        entityId: row.id,
        summary: isNew || !before ? `Created budget ${row.name}` : `Edited budget ${row.name}`,
        changes: before ? diffEntity(before, row) : null,
        snapshot: row,
      },
    });
  },

  async archiveBudget(id, archived) {
    const budget = get().budgets.find((b) => b.id === id);
    if (!budget) return;
    const row = { ...budget, archived, updatedAt: nowIso() };
    await commit({
      write: (d) => d.budgets.put(row),
      apply: (s) => ({ budgets: upsert(s.budgets, row) }),
      log: {
        type: 'budget.archived',
        entity: 'budget',
        entityId: id,
        summary: archived ? `Archived budget ${row.name}` : `Restored budget ${row.name}`,
        snapshot: row,
      },
    });
  },

  // -------------------------------------------------------------------------
  // Recurrences
  // -------------------------------------------------------------------------

  async saveRecurrence(rec, isNew = false) {
    const before = get().recurrences.find((r) => r.id === rec.id);
    const row: Recurrence = { ...rec, updatedAt: nowIso() };
    await commit({
      write: (d) => d.recurrences.put(row),
      apply: (s) => ({ recurrences: upsert(s.recurrences, row) }),
      log: {
        type: isNew || !before ? 'recurrence.created' : 'recurrence.amended',
        entity: 'recurrence',
        entityId: row.id,
        summary: isNew || !before ? `Created ${row.name}` : `Edited ${row.name}`,
        changes: before ? diffEntity(before, row) : null,
        snapshot: row,
      },
    });
  },

  async archiveRecurrence(id, archived) {
    const rec = get().recurrences.find((r) => r.id === id);
    if (!rec) return;
    const row = { ...rec, archived, updatedAt: nowIso() };
    await commit({
      write: (d) => d.recurrences.put(row),
      apply: (s) => ({ recurrences: upsert(s.recurrences, row) }),
      log: {
        type: 'recurrence.archived',
        entity: 'recurrence',
        entityId: id,
        summary: archived ? `Stopped ${row.name}` : `Resumed ${row.name}`,
        snapshot: row,
      },
    });
  },

  /**
   * Record something about ONE occurrence. This is the mechanism that keeps a
   * one-off amount change from rewriting the template (business rule R8).
   */
  async setOccurrence(override) {
    const before = get().overrides.find(
      (o) => o.recurrenceId === override.recurrenceId && o.dueDate === override.dueDate,
    );
    const row: OccurrenceOverride = { ...override, id: before?.id ?? override.id, updatedAt: nowIso() };
    const rec = get().recurrences.find((r) => r.id === row.recurrenceId);

    await commit({
      write: (d) => d.overrides.put(row),
      apply: (s) => ({ overrides: upsert(s.overrides, row) }),
      log: {
        type: 'occurrence.overridden',
        entity: 'occurrence',
        entityId: row.id,
        summary: `${rec?.name ?? 'Bill'} on ${row.dueDate}: ${row.status}`,
        changes: before ? diffEntity(before, row) : null,
        snapshot: row,
      },
    });
  },

  async clearOccurrence(recurrenceId, dueDate) {
    const existing = get().overrides.find((o) => o.recurrenceId === recurrenceId && o.dueDate === dueDate);
    if (!existing) return;
    const rec = get().recurrences.find((r) => r.id === recurrenceId);

    await commit({
      write: (d) => d.overrides.delete(existing.id),
      apply: (s) => ({ overrides: s.overrides.filter((o) => o.id !== existing.id) }),
      log: {
        type: 'occurrence.overridden',
        entity: 'occurrence',
        entityId: existing.id,
        summary: `${rec?.name ?? 'Bill'} on ${dueDate}: reset to scheduled`,
        snapshot: null,
      },
    });
  },

  // -------------------------------------------------------------------------
  // Goals, debts, people
  // -------------------------------------------------------------------------

  async saveGoal(goal, isNew = false) {
    const before = get().goals.find((g) => g.id === goal.id);
    const row: Goal = { ...goal, updatedAt: nowIso() };
    await commit({
      write: (d) => d.goals.put(row),
      apply: (s) => ({ goals: upsert(s.goals, row) }),
      log: {
        type: isNew || !before ? 'goal.created' : 'goal.amended',
        entity: 'goal',
        entityId: row.id,
        summary: isNew || !before ? `Created goal ${row.name}` : `Edited goal ${row.name}`,
        changes: before ? diffEntity(before, row) : null,
        snapshot: row,
      },
    });
  },

  async archiveGoal(id, archived) {
    const goal = get().goals.find((g) => g.id === id);
    if (!goal) return;
    const row = { ...goal, archived, updatedAt: nowIso() };
    await commit({
      write: (d) => d.goals.put(row),
      apply: (s) => ({ goals: upsert(s.goals, row) }),
      log: {
        type: 'goal.archived',
        entity: 'goal',
        entityId: id,
        summary: archived ? `Archived goal ${row.name}` : `Restored goal ${row.name}`,
        snapshot: row,
      },
    });
  },

  async saveDebt(debt, isNew = false) {
    const before = get().debts.find((d) => d.id === debt.id);
    const row: Debt = { ...debt, updatedAt: nowIso() };
    await commit({
      write: (d) => d.debts.put(row),
      apply: (s) => ({ debts: upsert(s.debts, row) }),
      log: {
        type: isNew || !before ? 'debt.created' : 'debt.amended',
        entity: 'debt',
        entityId: row.id,
        summary: isNew || !before ? `Recorded debt: ${row.name}` : `Edited debt: ${row.name}`,
        changes: before ? diffEntity(before, row) : null,
        snapshot: row,
      },
    });
  },

  async savePerson(person, isNew = false) {
    const before = get().people.find((p) => p.id === person.id);
    const row: Person = { ...person, updatedAt: nowIso() };
    await commit({
      write: (d) => d.people.put(row),
      apply: (s) => ({ people: upsert(s.people, row) }),
      log: {
        type: isNew || !before ? 'person.created' : 'person.amended',
        entity: 'person',
        entityId: row.id,
        summary: isNew || !before ? `Added ${row.name}` : `Edited ${row.name}`,
        changes: before ? diffEntity(before, row) : null,
        snapshot: row,
      },
    });
  },

  /**
   * Each person gets both a receivable and a payable account, so a running
   * balance exists whichever way the money later flows. All three rows land
   * together: a person with only one account, or an account with no person,
   * is exactly the half-state the integrity check would flag.
   */
  async addPerson(name, contact = null) {
    const trimmed = name.trim();
    const now = nowIso();
    const person: Person = {
      id: newId('per'),
      name: trimmed,
      contact: contact?.trim() || null,
      notes: null,
      color: null,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    const account = (cls: 'receivable' | 'payable'): Account => ({
      id: newId('acc'),
      class: cls,
      name: trimmed,
      parentId: null,
      currency: get().settings.baseCurrency,
      icon: null,
      color: null,
      archived: false,
      archivedAt: null,
      system: false,
      sortOrder: 0,
      notes: null,
      personId: person.id,
      createdAt: now,
      updatedAt: now,
    });
    const receivable = account('receivable');
    const payable = account('payable');

    await commit({
      write: async (d) => {
        await d.people.put(person);
        await d.accounts.bulkPut([receivable, payable]);
      },
      apply: (s) => ({
        people: [...s.people, person],
        accounts: [...s.accounts, receivable, payable],
      }),
      log: [
        { type: 'person.created', entity: 'person', entityId: person.id, summary: `Added ${trimmed}`, snapshot: person },
        { type: 'account.created', entity: 'account', entityId: receivable.id, summary: `Created ${trimmed}`, snapshot: receivable },
        { type: 'account.created', entity: 'account', entityId: payable.id, summary: `Created ${trimmed}`, snapshot: payable },
      ],
    });

    return { personId: person.id, receivableId: receivable.id, payableId: payable.id };
  },

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  async updateSettings(patch) {
    const before = get().settings;
    const row: Settings = { ...before, ...patch, updatedAt: nowIso() };
    const changes = diffEntity(before, row);

    await commit({
      write: (d) => d.settings.put(row),
      apply: () => ({ settings: row }),
      // A no-op save (the same value re-selected) is written but not logged;
      // history is for changes, not for keystrokes.
      log: changes.length > 0
        ? {
            type: 'settings.changed',
            entity: 'settings',
            entityId: 'settings',
            summary: `Changed ${changes.map((c) => c.label.toLowerCase()).join(', ')}`,
            changes,
            snapshot: row,
          }
        : undefined,
    });
  },

  // -------------------------------------------------------------------------
  // Backup and restore
  // -------------------------------------------------------------------------

  async exportBackup(includeAttachments = true) {
    const snapshot = await exportSnapshot(db());
    if (includeAttachments) {
      const rows = await db().attachments.toArray();
      snapshot.data.attachments = await Promise.all(rows.map(encodeAttachment));
      snapshot.counts.attachments = rows.length;
    }
    return snapshot;
  },

  async restoreBackup(raw) {
    const parsed = validateSnapshot(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    // `validateSnapshot` checks the envelope. This checks the contents: a file
    // can be perfectly well-formed JSON and still describe a ledger that does
    // not add up, or point at accounts it does not contain. IndexedDB has no
    // foreign keys to catch that, so it is caught here or not at all.
    const audit = checkIntegrity(parsed.snapshot.data as unknown as Dataset);
    if (!audit.ok) {
      return {
        ok: false,
        error: `This backup is damaged and was not restored. ${summariseIssues(audit).slice(0, 3).join(' ')}`,
      };
    }

    // Dangling references are mended rather than treated as fatal — a receipt
    // pointing at a transaction that is not in the file is worth clearing, not
    // worth refusing the whole restore over. Nothing is invented.
    const { data: mended, repaired } = repairDataset(parsed.snapshot.data as unknown as Dataset);
    // The repaired dataset is read-only by type; `restoreSnapshot` only reads it.
    const snapshot = {
      ...parsed.snapshot,
      data: { ...parsed.snapshot.data, ...mended },
    } as unknown as Snapshot;

    const report = await restoreSnapshot(db(), snapshot);
    if (!report.ok) return { ok: false, error: report.error };

    // Receipts are stored as blobs, so they travel base64-encoded and are
    // rebuilt here. A backup taken without them simply restores none. Clearing
    // and refilling in one transaction means a failure cannot leave the
    // restored ledger holding the *previous* backup's receipts.
    const encoded = parsed.snapshot.data.attachments;
    const rows = Array.isArray(encoded) ? encoded.map(decodeAttachment) : [];

    await commit({
      write: async (d) => {
        await d.attachments.clear();
        if (rows.length > 0) await d.attachments.bulkPut(rows);
      },
      log: {
        type: 'data.restored',
        entity: 'settings',
        entityId: 'settings',
        summary: repaired > 0
          ? `Restored a backup made on ${parsed.snapshot.exportedAt.slice(0, 10)}, mending ${repaired} broken reference${repaired === 1 ? '' : 's'}`
          : `Restored a backup made on ${parsed.snapshot.exportedAt.slice(0, 10)}`,
        snapshot: parsed.snapshot.counts,
      },
    });

    // Re-read everything: memory must come from the restored database, not be
    // patched towards it.
    await get().init(get().namespace);
    return { ok: true };
  },

  async resetEverything() {
    await wipe(db());
    set({ ops: [] });
    await get().init(get().namespace);
  },

  // -------------------------------------------------------------------------
  // Sync plumbing
  // -------------------------------------------------------------------------

  async markOpsSynced(ids, seqByOpId) {
    const updated = get()
      .ops.filter((o) => ids.includes(o.id))
      .map((o) => ({ ...o, synced: 1 as const, serverSeq: seqByOpId[o.id] ?? o.serverSeq }));
    if (updated.length === 0) return;
    await db().ops.bulkPut(updated);
    set((s) => ({ ops: s.ops.map((o) => updated.find((u) => u.id === o.id) ?? o) }));
  },

  /**
   * Accept ops authored elsewhere. Snapshots carry the full entity, so applying
   * a peer's change is a put rather than a replay of the whole log.
   */
  async ingestRemoteOps(remote) {
    if (remote.length === 0) return;
    const known = new Set(get().ops.map((o) => o.id));
    const fresh = remote.filter((o) => !known.has(o.id)).sort((a, b) => (a.serverSeq ?? 0) - (b.serverSeq ?? 0));
    if (fresh.length === 0) return;

    // The peer's ops and the entities they carry are applied together. Applied
    // separately, an interrupted pull could record that a change had arrived
    // while leaving the change itself unwritten — and the op id is what stops
    // it being pulled again.
    //
    // The op itself is always stored, even when its payload is rejected below.
    // Dropping it would mean pulling the same bad row on every sync forever.
    const database = db();
    await database.transaction('rw', database.tables, async () => {
      await database.ops.bulkPut(fresh);

      for (const op of fresh) {
        if (op.snapshot == null) continue;
        // A peer may be running an older build, or have data of its own that is
        // damaged. Nothing arriving over the wire is trusted into the ledger
        // without the same checks a restored backup gets.
        if (!acceptableSnapshot(op)) continue;
        switch (op.entity) {
          case 'transaction':
            await database.transactions.put(op.snapshot as Transaction);
            break;
          case 'account':
            await database.accounts.put(op.snapshot as Account);
            break;
          case 'budget':
            await database.budgets.put(op.snapshot as Budget);
            break;
          case 'recurrence':
            await database.recurrences.put(op.snapshot as Recurrence);
            break;
          case 'occurrence':
            await database.overrides.put(op.snapshot as OccurrenceOverride);
            break;
          case 'goal':
            await database.goals.put(op.snapshot as Goal);
            break;
          case 'debt':
            await database.debts.put(op.snapshot as Debt);
            break;
          case 'person':
            await database.people.put(op.snapshot as Person);
            break;
          case 'settings':
            break; // settings are device-local; never overwritten by a peer
          default:
            break;
        }
      }
    });

    opState.lamport = Math.max(opState.lamport, highestLamport(fresh));
    await get().init(get().namespace);
  },

  // -------------------------------------------------------------------------
  // Auto-posting
  // -------------------------------------------------------------------------

  /**
   * Record occurrences the user has asked Pocketa to post for them.
   *
   * Only runs for a recurrence with `autoPost` explicitly enabled, only for
   * dates that have actually arrived, and never twice for the same occurrence —
   * the override is the guard. The caller announces what was posted, because
   * "opted in" is not the same as "may happen unannounced".
   */
  async runAutoPost() {
    const asOf = today();

    const candidates = get().recurrences.filter((r) => r.autoPost && !r.archived);
    if (candidates.length === 0) return { posted: [] };

    const views = buildOccurrences({
      recurrences: candidates,
      overrides: get().overrides,
      // A month back is enough to catch anything missed while the app was shut,
      // without resurrecting the entire history on a fresh install.
      range: { from: addMonthsLocal(asOf, -1), to: asOf },
      asOf,
    });

    const due = views.filter(
      (v) => (v.status === 'due' || v.status === 'overdue') && v.override == null,
    );

    const posted: Array<{ name: string; amount: number; date: string; txnId: ID }> = [];

    for (const occurrence of due) {
      const rec = occurrence.recurrence;
      const common = {
        date: occurrence.dueDate,
        merchant: rec.merchant ?? rec.name,
        notes: rec.notes,
        tags: rec.tags,
        recurrenceId: rec.id,
        occurrenceKey: occurrence.key,
      };

      const draft: TxnDraft | null =
        rec.kind === 'transfer'
          ? rec.toAccountId
            ? { ...common, type: 'move', kind: 'transfer', fromAccountId: rec.accountId, toAccountId: rec.toAccountId, amount: occurrence.amount }
            : null
          : rec.categoryId
            ? rec.kind === 'income'
              ? { ...common, type: 'earn', accountId: rec.accountId, allocations: [{ categoryId: rec.categoryId, amount: occurrence.amount }] }
              : { ...common, type: 'spend', accountId: rec.accountId, allocations: [{ categoryId: rec.categoryId, amount: occurrence.amount }] }
            : null;

      if (!draft) continue;

      const result = await get().createTransaction(draft);
      if (!result.ok) continue; // a bad template must not block the others

      await get().setOccurrence({
        id: newId('ovr'),
        recurrenceId: rec.id,
        dueDate: occurrence.dueDate,
        status: 'paid',
        amount: null,
        paidDate: occurrence.dueDate,
        txnId: result.value.id,
        notes: 'Posted automatically',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });

      posted.push({
        name: rec.name,
        amount: occurrence.amount,
        date: occurrence.dueDate,
        txnId: result.value.id,
      });
    }

    return { posted };
  },

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  async addAttachment(file, txnId) {
    const prepared = await prepareAttachment(file, {
      txnId,
      usedBytes: totalBytes(get().attachments),
    });
    if (!prepared.ok) return { ok: false, error: prepared.error };

    const attachment = prepared.attachment;
    await commit({
      write: (d) => d.attachments.put(attachment),
      apply: (s) => ({ attachments: [...s.attachments, attachment] }),
    });
    return { ok: true, id: attachment.id };
  },

  /** Point attachments at a transaction once it has an id. */
  async linkAttachments(txnId, attachmentIds) {
    if (attachmentIds.length === 0) return;
    const rows = get()
      .attachments.filter((a) => attachmentIds.includes(a.id))
      .map((a) => ({ ...a, txnId }));
    if (rows.length === 0) return;

    const txn = get().transactions.find((t) => t.id === txnId);
    const updated = txn
      ? {
          ...txn,
          attachmentIds: [...new Set([...txn.attachmentIds, ...attachmentIds])],
          updatedAt: nowIso(),
        }
      : null;

    await commit({
      write: async (d) => {
        await d.attachments.bulkPut(rows);
        if (updated) await d.transactions.put(updated);
      },
      apply: (s) => ({
        attachments: s.attachments.map((a) => rows.find((r) => r.id === a.id) ?? a),
        transactions: updated
          ? s.transactions.map((t) => (t.id === txnId ? updated : t))
          : s.transactions,
      }),
    });
  },

  /**
   * Remove a receipt.
   *
   * This is a real delete, not a void: the file is the only copy and keeping an
   * invisible blob would quietly consume the storage cap forever. The
   * transaction it belonged to is untouched.
   */
  async removeAttachment(id) {
    const attachment = get().attachments.find((a) => a.id === id);
    if (!attachment) return;

    const txn = attachment.txnId
      ? get().transactions.find((t) => t.id === attachment.txnId)
      : undefined;
    const updated = txn
      ? { ...txn, attachmentIds: txn.attachmentIds.filter((x) => x !== id), updatedAt: nowIso() }
      : null;

    // The blob and the reference to it go together. Dropping one without the
    // other leaves either a dangling id or an orphaned file eating the cap.
    await commit({
      write: async (d) => {
        await d.attachments.delete(id);
        if (updated) await d.transactions.put(updated);
      },
      apply: (s) => ({
        attachments: s.attachments.filter((a) => a.id !== id),
        transactions: updated
          ? s.transactions.map((t) => (t.id === updated.id ? updated : t))
          : s.transactions,
      }),
      log: updated
        ? {
            type: 'txn.amended',
            entity: 'transaction',
            entityId: updated.id,
            summary: `Removed receipt "${attachment.name}"`,
            snapshot: updated,
          }
        : undefined,
    });
  },

  // -------------------------------------------------------------------------
  // Carpool
  // -------------------------------------------------------------------------

  async saveCarpool(carpool, isNew = false) {
    const before = get().carpools.find((c) => c.id === carpool.id);
    const row: Carpool = { ...carpool, updatedAt: nowIso() };
    await commit({
      write: (d) => d.carpools.put(row),
      apply: (s) => ({ carpools: upsert(s.carpools, row) }),
      log: {
        type: isNew || !before ? 'carpool.created' : 'carpool.amended',
        entity: 'carpool',
        entityId: row.id,
        summary: isNew || !before ? `Created carpool ${row.name}` : `Edited carpool ${row.name}`,
        changes: before ? diffEntity(before, row) : null,
        snapshot: row,
      },
    });
  },

  async saveCarpoolRider(rider, isNew = false) {
    const before = get().carpoolRiders.find((r) => r.id === rider.id);
    const row: CarpoolRider = { ...rider, updatedAt: nowIso() };
    const name = get().people.find((p) => p.id === row.personId)?.name ?? 'Rider';

    await commit({
      write: (d) => d.carpoolRiders.put(row),
      apply: (s) => ({ carpoolRiders: upsert(s.carpoolRiders, row) }),
      log: {
        type: isNew || !before ? 'carpool.rider_added' : 'carpool.rider_amended',
        entity: 'carpool',
        entityId: row.id,
        summary: isNew || !before ? `Added ${name} to the carpool` : `Updated ${name}`,
        changes: before ? diffEntity(before, row) : null,
        snapshot: row,
      },
    });
  },

  async logTrip(trip, isNew = false) {
    const before = get().carpoolTrips.find((t) => t.id === trip.id);
    if (before?.settlementId) {
      // A billed trip is history. Editing it would silently change an invoice
      // the rider has already been given.
      return;
    }
    const row: CarpoolTrip = { ...trip, updatedAt: nowIso() };
    await commit({
      write: (d) => d.carpoolTrips.put(row),
      apply: (s) => ({ carpoolTrips: upsert(s.carpoolTrips, row) }),
      log: {
        type: isNew || !before ? 'carpool.trip_logged' : 'carpool.trip_amended',
        entity: 'carpool_trip',
        entityId: row.id,
        summary: `${isNew || !before ? 'Logged' : 'Edited'} trip on ${row.date} with ${row.riderIds.length} rider${row.riderIds.length === 1 ? '' : 's'}`,
        changes: before ? diffEntity(before, row) : null,
        snapshot: row,
      },
    });
  },

  async deleteTrip(id) {
    const trip = get().carpoolTrips.find((t) => t.id === id);
    if (!trip || trip.settlementId) return; // never unpick a billed trip
    await commit({
      write: (d) => d.carpoolTrips.delete(id),
      apply: (s) => ({ carpoolTrips: s.carpoolTrips.filter((t) => t.id !== id) }),
      log: {
        type: 'carpool.trip_removed',
        entity: 'carpool_trip',
        entityId: id,
        summary: `Removed the trip on ${trip.date}`,
        snapshot: trip,
      },
    });
  },

  /**
   * Bill a period.
   *
   * This is the only point at which a carpool touches money. Each rider's
   * unbilled trips become one receivable, and the trips they covered are
   * stamped with the settlement id so they can never be charged again.
   *
   * If any single receivable fails to build, nothing is written at all — a
   * half-billed month would be worse than an unbilled one.
   */
  async settleCarpool(carpoolId, range, lines) {
    const carpool = get().carpools.find((c) => c.id === carpoolId);
    if (!carpool) return { ok: false, error: 'That carpool no longer exists.' };
    if (!carpool.settleCategoryId) {
      return { ok: false, error: 'Choose a category for carpool money in the carpool settings first.' };
    }
    const billable = lines.filter((l) => l.amount > 0 && l.trips > 0);
    if (billable.length === 0) return { ok: false, error: 'There is nothing to bill for this period.' };

    const settlementId = newId('imp');
    const created: Transaction[] = [];
    const settledLines: CarpoolSettlementLine[] = [];
    const newAccounts: Account[] = [];

    for (const line of billable) {
      // Every rider needs a receivable account; make one on first billing.
      let receivable =
        get().accounts.find((a) => a.class === 'receivable' && a.personId === line.personId) ??
        newAccounts.find((a) => a.personId === line.personId);

      if (!receivable) {
        receivable = {
          id: newId('acc'),
          class: 'receivable',
          name: line.personName,
          parentId: null,
          currency: get().settings.baseCurrency,
          icon: null,
          color: null,
          archived: false,
          archivedAt: null,
          system: false,
          sortOrder: 0,
          notes: null,
          personId: line.personId,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        // Held back, not saved here. A receivable written now and a billing that
        // then fails would leave an account for a person who was never charged.
        newAccounts.push(receivable);
      }

      const built = buildCarpoolSettlement(
        {
          date: range.to,
          personAccountId: receivable.id,
          categoryId: carpool.settleCategoryId,
          amount: line.amount,
          merchant: carpool.name,
          notes: `${line.trips} trip${line.trips === 1 ? '' : 's'}, ${range.from} to ${range.to}`,
        },
        get().ledgerContext(),
      );

      if (!built.ok) {
        return { ok: false, error: built.issues[0]?.message ?? 'The charge could not be recorded.' };
      }
      created.push(built.value);
      settledLines.push({ ...line, txnId: built.value.id });
    }

    // Stamp the covered trips so a second run cannot bill them again.
    const covered = tripsToSettle(get().carpoolTrips, range, billable.map((l) => l.riderId))
      .map((t) => ({ ...t, settlementId, updatedAt: nowIso() }));

    const settlement: CarpoolSettlement = {
      id: settlementId,
      carpoolId,
      from: range.from,
      to: range.to,
      lines: settledLines,
      total: settledLines.reduce((sum, l) => sum + l.amount, 0),
      tripCount: covered.length,
      createdAt: nowIso(),
    };

    // Everything a billing produces — new receivable accounts, the charges, the
    // stamps that stop a trip being billed twice, the settlement, and the record
    // of all of it — lands in one transaction or none of it does.
    await commit({
      write: async (d) => {
        if (newAccounts.length) await d.accounts.bulkPut(newAccounts);
        await d.transactions.bulkPut(created);
        if (covered.length) await d.carpoolTrips.bulkPut(covered);
        await d.carpoolSettlements.put(settlement);
      },
      apply: (s) => ({
        accounts: newAccounts.reduce((list, a) => upsert(list, a), s.accounts),
        transactions: [...s.transactions, ...created],
        carpoolTrips: s.carpoolTrips.map((t) => covered.find((c) => c.id === t.id) ?? t),
        carpoolSettlements: [...s.carpoolSettlements, settlement],
      }),
      log: [
        ...newAccounts.map((a) => ({
          type: 'account.created' as const,
          entity: 'account' as const,
          entityId: a.id,
          summary: `Created ${a.name}`,
          snapshot: a,
        })),
        {
          type: 'carpool.settled' as const,
          entity: 'carpool_settlement' as const,
          entityId: settlement.id,
          summary: `Billed ${settledLines.length} rider${settledLines.length === 1 ? '' : 's'} for ${covered.length} trip${covered.length === 1 ? '' : 's'}`,
          snapshot: settlement,
        },
      ],
    });

    return { ok: true, settlement };
  },

  /**
   * Populate the ledger with three months of plausible activity.
   *
   * Everything goes through the normal builders and validators — the sample
   * data is not privileged, so if it loads cleanly the engine genuinely handles
   * splits, shared bills, refunds, card payments, debts and reconciliations.
   */
  async loadSampleData() {
    const { buildDemo, buildDemoRefund } = await import('../data/demo');

    const findCategory = (name: string) => findCategoryByName(get().accounts, name);
    const seededCash = get().accounts.find((a) => a.class === 'cash' && !a.archived);
    const demo = buildDemo(findCategory, get().settings.baseCurrency, seededCash?.id);

    for (const person of demo.people) await get().savePerson(person, true);
    for (const account of demo.accounts) {
      await get().saveAccount(account, !demo.reusedAccountIds.includes(account.id));
    }

    const { created, failed } = await get().createTransactions(demo.drafts);

    // The refund has to come after its original exists, so it can link to it.
    const jacket = created.find((t) => t.merchant === 'Outfitters');
    if (jacket) {
      const categoryId = jacket.postings.find(
        (p) => get().accounts.find((a) => a.id === p.accountId)?.class === 'expense_category',
      )?.accountId;
      const cardId = jacket.postings.find((p) => p.amount < 0)?.accountId;
      if (categoryId && cardId) {
        await get().createTransaction(
          buildDemoRefund(jacket.id, cardId, categoryId, addDaysLocal(jacket.date, 6)),
        );
      }
    }

    for (const budget of demo.budgets) await get().saveBudget(budget, true);
    for (const goal of demo.goals) await get().saveGoal(goal, true);
    for (const rec of demo.recurrences) await get().saveRecurrence(rec, true);
    for (const override of demo.overrides) await get().setOccurrence(override);

    await get().updateSettings({ onboarded: true });

    if (failed.length > 0) {
      console.warn('sample data: some rows were rejected', failed.slice(0, 3));
    }
    return { ok: true, created: created.length, failed: failed.length };
  },
}));

function addMonthsLocal(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

function addDaysLocal(date: string, n: number): string {
  const ms = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return new Date(ms + n * 86400000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Summaries used by the audit trail
// ---------------------------------------------------------------------------

function describeTxn(txn: Transaction, accounts: Map<ID, Account>): string {
  const category = txn.postings
    .map((p) => accounts.get(p.accountId))
    .find((a) => a?.class === 'expense_category' || a?.class === 'income_category');
  const label = txn.merchant || category?.name || 'transaction';
  return `${label} on ${txn.date}`;
}

/**
 * A field-level diff between two versions of a transaction, expressed in terms
 * the user recognises — amount, account, category — rather than postings.
 */
function summariseTxnChanges(
  before: Transaction,
  after: Transaction,
  accounts: Map<ID, Account>,
): FieldChange[] {
  const changes = diffEntity(before, after);

  const amountOf = (t: Transaction) =>
    t.postings.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0);
  if (amountOf(before) !== amountOf(after)) {
    changes.unshift({
      field: 'amount',
      label: 'Amount',
      before: amountOf(before),
      after: amountOf(after),
      money: true,
    });
  }

  const catOf = (t: Transaction) =>
    t.postings
      .map((p) => accounts.get(p.accountId))
      .filter((a) => a?.class === 'expense_category' || a?.class === 'income_category')
      .map((a) => a!.name)
      .join(', ');
  if (catOf(before) !== catOf(after)) {
    changes.push({ field: 'categoryId', label: 'Category', before: catOf(before), after: catOf(after) });
  }

  const accOf = (t: Transaction) =>
    t.postings
      .map((p) => accounts.get(p.accountId))
      .filter((a) => a && a.class !== 'expense_category' && a.class !== 'income_category')
      .map((a) => a!.name)
      .join(' → ');
  if (accOf(before) !== accOf(after)) {
    changes.push({ field: 'accountId', label: 'Account', before: accOf(before), after: accOf(after) });
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

export const SYSTEM_IDS = { adjustment: SYSTEM_ADJUSTMENT_ID, opening: SYSTEM_OPENING_ID };

export function todayInStore(): string {
  return today();
}

export { draftFromTransaction };
