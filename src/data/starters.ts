/**
 * Starter items — the Cash account and built-in categories every Pocketa
 * account begins with.
 *
 * They used to be created on each device with a random id, so a phone and a
 * laptop on the same account each had their own "Cash" and their own
 * "Groceries", unrelated as far as sync could tell. Deleting Cash on one device
 * left the other's untouched, and a transaction filed under Groceries on the
 * phone pointed at a category the laptop did not have.
 *
 * Now every starter has one fixed id, the same everywhere. Existing data is
 * brought into line by `normalizeStarters`, run when the app opens:
 *
 *   1. Work out which local and logged rows are starters under an old id
 *      (aliases). A row is a starter when it matches a starter's kind and
 *      original name and was never created by the person — seeding was never
 *      logged, so a `*.created` op means a user-made row, which is left alone.
 *   2. Rewrite every reference to an old id, make sure the shared row exists,
 *      and drop the old rows.
 *   3. Log an alias op for any old id this device introduced, so other devices
 *      can translate transactions that still name it.
 *
 * It is idempotent: a device already in line finds nothing to do.
 */

import type { Table } from 'dexie';
import type { Account, AccountClass, ID } from '../core/types';
import { compareOps, makeOp, type Op } from './oplog';
import type { PocketaDB } from './db';

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const slug = (s: string) =>
  s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** The shared id of a starter, from its kind and name. Names are unique within a kind. */
export function starterId(cls: AccountClass, name: string): ID {
  const prefix = cls === 'expense_category' ? 'st_exp' : cls === 'income_category' ? 'st_inc' : `st_${cls}`;
  return cls === 'expense_category' || cls === 'income_category' ? `${prefix}_${slug(name)}` : prefix;
}

export function isStarterId(id: ID): boolean {
  return id.startsWith('st_');
}

/** Filled in by seed.ts so this module needs no copy of the starter list. */
let starterNames: ReadonlyMap<string, ID> = new Map();
export function registerStarters(rows: ReadonlyArray<Pick<Account, 'id' | 'class' | 'name'>>): void {
  starterNames = new Map(rows.map((r) => [`${r.class}:${r.name.toLowerCase()}`, r.id]));
}
function starterFor(cls: string, name: string): ID | null {
  return starterNames.get(`${cls}:${name.toLowerCase()}`) ?? null;
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

export const ALIAS_OP = 'account.aliased' as const;

/** Old id → shared id, from alias ops and from what the rows and log say about each id. */
export function findAliases(ops: readonly Op[], local: readonly Account[]): Map<ID, ID> {
  const aliases = new Map<ID, ID>();

  // Explicit: another device already decided.
  for (const op of ops) {
    if (op.type !== ALIAS_OP) continue;
    const to = op.changes?.find((c) => c.field === 'aliasTo')?.after;
    if (typeof to === 'string' && op.entityId && op.entityId !== to) aliases.set(op.entityId, to);
  }

  // Inferred: what each id was originally called, and whether a person made it.
  const created = new Set<ID>();
  const originalName = new Map<ID, { cls: string; name: string }>();
  for (const op of [...ops].sort(compareOps)) {
    if (op.entity !== 'account' || !op.entityId) continue;
    if (op.type === 'account.created' || op.type === 'category.created') created.add(op.entityId);
    if (originalName.has(op.entityId)) continue;
    const row = op.snapshot as Partial<Account> | null;
    if (!row?.class) continue;
    // A rename recorded in the first op still tells us the name it started with.
    const renamed = op.changes?.find((c) => c.field === 'name');
    const name = typeof renamed?.before === 'string' ? renamed.before : row.name;
    if (typeof name === 'string') originalName.set(op.entityId, { cls: row.class, name });
  }
  for (const a of local) {
    if (!originalName.has(a.id)) originalName.set(a.id, { cls: a.class, name: a.name });
  }

  for (const [id, { cls, name }] of originalName) {
    if (isStarterId(id) || created.has(id) || aliases.has(id)) continue;
    if (id === 'sys_adjustment' || id === 'sys_opening') continue;
    const to = starterFor(cls, name);
    if (to) aliases.set(id, to);
  }
  return aliases;
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

function swap(aliases: ReadonlyMap<ID, ID>, id: ID): ID;
function swap(aliases: ReadonlyMap<ID, ID>, id: ID | null): ID | null;
function swap(aliases: ReadonlyMap<ID, ID>, id: ID | null): ID | null {
  return id != null ? aliases.get(id) ?? id : id;
}

async function rewrite<T extends { id: ID }>(
  table: Table<T, string>,
  change: (row: T) => T | null,
): Promise<number> {
  const updated: T[] = [];
  for (const row of await table.toArray()) {
    const next = change(row);
    if (next) updated.push(next);
  }
  if (updated.length) await table.bulkPut(updated);
  return updated.length;
}

export interface NormalizeResult {
  aliases: Map<ID, ID>;
  /** Rows rewritten or removed. */
  changed: number;
  /** Alias ops this device logged for other devices. */
  logged: number;
}

/**
 * Bring this device's starters onto the shared ids. `deviceId` and `lamport`
 * are needed to log alias ops other devices will learn from.
 */
export async function normalizeStarters(
  database: PocketaDB,
  deviceId: string,
): Promise<NormalizeResult> {
  const ops = await database.ops.toArray();
  const accounts = await database.accounts.toArray();
  const aliases = findAliases(ops, accounts);
  if (aliases.size === 0) return { aliases, changed: 0, logged: 0 };

  const alreadyLogged = new Set(ops.filter((o) => o.type === ALIAS_OP).map((o) => o.entityId));
  const loggedIds = new Set(ops.filter((o) => o.entity === 'account').map((o) => o.entityId));
  let changed = 0;
  let logged = 0;

  await database.transaction('rw', database.tables, async () => {
    // --- the shared rows ----------------------------------------------------
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const sources = new Map<ID, Account[]>();
    for (const a of accounts) {
      const to = aliases.get(a.id);
      if (!to) continue;
      if (!sources.has(to)) sources.set(to, []);
      sources.get(to)!.push(a);
    }
    for (const [to, rows] of sources) {
      if (!byId.has(to)) {
        // Prefer a row the person has touched (it is in the log) over an
        // untouched seed, then the oldest.
        const pick = [...rows].sort(
          (x, y) =>
            Number(loggedIds.has(y.id)) - Number(loggedIds.has(x.id)) || x.createdAt.localeCompare(y.createdAt),
        )[0];
        await database.accounts.put({ ...pick, id: to, parentId: swap(aliases, pick.parentId) });
        changed++;
      }
    }
    const stale = accounts.filter((a) => aliases.has(a.id)).map((a) => a.id);
    if (stale.length) {
      await database.accounts.bulkDelete(stale);
      changed += stale.length;
    }

    // --- every reference ----------------------------------------------------
    changed += await rewrite(database.accounts, (a) =>
      a.parentId && aliases.has(a.parentId) ? { ...a, parentId: swap(aliases, a.parentId) } : null,
    );
    changed += await rewrite(database.transactions, (t) =>
      t.postings.some((p) => aliases.has(p.accountId))
        ? { ...t, postings: t.postings.map((p) => ({ ...p, accountId: swap(aliases, p.accountId) })) }
        : null,
    );
    changed += await rewrite(database.budgets, (b) =>
      b.categoryIds.some((id) => aliases.has(id)) || (b.rolloverAccountId && aliases.has(b.rolloverAccountId))
        ? {
            ...b,
            categoryIds: [...new Set(b.categoryIds.map((id) => swap(aliases, id)))],
            rolloverAccountId: swap(aliases, b.rolloverAccountId),
          }
        : null,
    );
    changed += await rewrite(database.recurrences, (r) =>
      [r.accountId, r.categoryId, r.toAccountId].some((id) => id != null && aliases.has(id))
        ? {
            ...r,
            accountId: swap(aliases, r.accountId),
            categoryId: swap(aliases, r.categoryId),
            toAccountId: swap(aliases, r.toAccountId),
          }
        : null,
    );
    changed += await rewrite(database.goals, (g) => (aliases.has(g.accountId) ? { ...g, accountId: swap(aliases, g.accountId) } : null));
    changed += await rewrite(database.debts, (d) => (aliases.has(d.accountId) ? { ...d, accountId: swap(aliases, d.accountId) } : null));
    changed += await rewrite(database.imports, (i) =>
      i.accountId && aliases.has(i.accountId) ? { ...i, accountId: swap(aliases, i.accountId) } : null,
    );
    changed += await rewrite(database.carpools, (c) =>
      c.settleCategoryId && aliases.has(c.settleCategoryId)
        ? { ...c, settleCategoryId: swap(aliases, c.settleCategoryId) }
        : null,
    );

    // --- tell other devices about ids only this device knew -------------------
    const state = { deviceId, lamport: ops.reduce((m, o) => Math.max(m, o.lamport), 0) };
    const announce = [...aliases].filter(([from]) => !alreadyLogged.has(from) && !loggedIds.has(from));
    if (announce.length) {
      await database.ops.bulkPut(
        announce.map(([from, to]) =>
          makeOp(state, {
            type: ALIAS_OP,
            entity: 'account',
            entityId: from,
            summary: 'Matched a built-in item to the one shared by all devices',
            // No snapshot: an older build skips ops without one, rather than
            // writing a half-formed account.
            snapshot: null,
            changes: [{ field: 'aliasTo', label: 'Shared id', before: from, after: to }],
          }),
        ),
      );
      logged = announce.length;
    }
  });

  return { aliases, changed, logged };
}
