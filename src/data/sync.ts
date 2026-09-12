/**
 * Cross-device sync.
 *
 * Pocketa is local-first: IndexedDB is the working copy and the app is fully
 * usable with no network and no account. Signing in adds durability and lets a
 * second device catch up — it is never on the read path.
 *
 * The unit of sync is the operation, not the entity. Ops are immutable and
 * keyed by id, so pushing twice is harmless and merging is a set union. The
 * server assigns a monotonic sequence, which gives every device the same total
 * order and makes a concurrent edit resolve identically everywhere — both
 * versions stay visible in the audit history either way.
 *
 * Configuration is optional. Without credentials the app runs exactly as before
 * and the UI says plainly that sync is unavailable, rather than failing quietly.
 */

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { mergeOps, pendingOps, type Op } from './oplog';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const syncConfigured = Boolean(URL && KEY);

let clientPromise: Promise<SupabaseClient> | null = null;

/**
 * The Supabase SDK is loaded on demand.
 *
 * It is roughly 400 KB, and a user who never signs in never needs it — so it
 * stays out of the initial bundle and the app keeps booting instantly offline.
 */
export async function getClient(): Promise<SupabaseClient | null> {
  if (!syncConfigured) return null;
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(URL!, KEY!, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }),
    );
  }
  return clientPromise;
}

export type SyncState = 'unconfigured' | 'signed_out' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncedAt: string | null;
  message: string | null;
}

/** The row shape in the `ops` table. One table carries every entity's history. */
export interface RemoteOp {
  id: string;
  user_id: string;
  server_seq: number;
  device_id: string;
  lamport: number;
  created_at: string;
  type: string;
  entity: string;
  entity_id: string;
  summary: string;
  changes: unknown;
  snapshot: unknown;
}

function toRemote(op: Op, userId: string): Omit<RemoteOp, 'server_seq'> {
  return {
    id: op.id,
    user_id: userId,
    device_id: op.deviceId,
    lamport: op.lamport,
    created_at: op.createdAt,
    type: op.type,
    entity: op.entity,
    entity_id: op.entityId,
    summary: op.summary,
    changes: op.changes,
    snapshot: op.snapshot,
  };
}

function fromRemote(row: RemoteOp): Op {
  return {
    id: row.id,
    type: row.type as Op['type'],
    entity: row.entity as Op['entity'],
    entityId: row.entity_id,
    lamport: row.lamport,
    deviceId: row.device_id,
    createdAt: row.created_at,
    summary: row.summary,
    changes: (row.changes as Op['changes']) ?? null,
    snapshot: row.snapshot ?? null,
    serverSeq: row.server_seq,
    synced: 1,
  };
}

export async function getSession(): Promise<Session | null> {
  const supabase = await getClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signInWithGoogle(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await getClient();
  if (!supabase) return { ok: false, error: 'Sync is not configured for this build.' };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signInWithEmail(email: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await getClient();
  if (!supabase) return { ok: false, error: 'Sync is not configured for this build.' };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Watch the account, rather than asking once.
 *
 * A one-shot `getSession()` misses everything that happens afterwards — the
 * redirect back from Google, a token expiring, signing out in another tab. The
 * app needs to react to all of those, not just to how things stood at boot.
 */
export async function onAuthChange(
  handler: (session: Session | null) => void,
): Promise<() => void> {
  const supabase = await getClient();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => handler(session));
  return () => data.subscription.unsubscribe();
}

export async function signOut(): Promise<void> {
  const supabase = await getClient();
  await supabase?.auth.signOut();
}

/**
 * Everything sync needs from a server.
 *
 * Extracted so the part that can actually go wrong — whether two devices
 * converge on the same ledger — can be tested against an in-memory server
 * rather than only against a live project. The Supabase implementation below
 * is a thin adapter; the merge rules live in `syncOnce`.
 */
export interface SyncTransport {
  /** The signed-in account, or null when signed out. */
  currentUserId(): Promise<string | null>;
  /** Upsert by id, returning the sequence the server assigned to each row. */
  push(rows: Array<Omit<RemoteOp, 'server_seq'>>): Promise<Array<{ id: string; server_seq: number }>>;
  /** This account's ops after `since`, in sequence order. */
  pull(userId: string, since: number, limit: number): Promise<RemoteOp[]>;
}

/** The real transport, talking to the user's own Supabase project. */
export async function supabaseTransport(): Promise<SyncTransport | null> {
  const supabase = await getClient();
  if (!supabase) return null;

  return {
    async currentUserId() {
      const { data } = await supabase.auth.getSession();
      return data.session?.user.id ?? null;
    },
    async push(rows) {
      // Upsert on id: re-sending an op the server already has is a no-op, which
      // is what makes an interrupted push safe to retry.
      const { data, error } = await supabase
        .from('ops')
        .upsert(rows, { onConflict: 'id' })
        .select('id, server_seq');
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ id: string; server_seq: number }>;
    },
    async pull(userId, since, limit) {
      const { data, error } = await supabase
        .from('ops')
        .select('*')
        // Redundant with row-level security, but a client that asks only for
        // its own rows cannot be the thing that leaks them.
        .eq('user_id', userId)
        .gt('server_seq', since)
        .order('server_seq', { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as RemoteOp[];
    },
  };
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: Op[];
  /** Server sequence assigned to each pushed op. */
  seqByOpId: Record<string, number>;
  error?: string;
}

/**
 * One sync round: push what this device has authored, then pull everything it
 * has not seen. Both halves are idempotent, so an interrupted sync is safe to
 * repeat.
 */
export interface SyncOptions {
  /** Overridden in tests; defaults to the user's Supabase project. */
  transport?: SyncTransport | null;
  /** Overridden in tests; defaults to the browser's own reading. */
  online?: boolean;
  /** Ops pulled per round. */
  limit?: number;
}

/**
 * One sync round: push what this device authored, then pull what it has not
 * seen.
 *
 * Both halves are idempotent. Pushing is an upsert keyed by op id, so a push
 * that reached the server but whose acknowledgement was lost is safe to repeat.
 * Pulling asks only for sequences above the highest already held, and filters
 * out anything already known by id, so a duplicated response changes nothing.
 *
 * There is no merge conflict to resolve here: ops are immutable and never
 * edited, so two devices converge by taking the union and ordering it by the
 * sequence the server assigned.
 */
export async function syncOnce(
  localOps: readonly Op[],
  options: SyncOptions = {},
): Promise<SyncResult> {
  const online = options.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine);
  const transport =
    options.transport !== undefined ? options.transport : await supabaseTransport();

  if (!transport) {
    return { ok: false, pushed: 0, pulled: [], seqByOpId: {}, error: 'Sync is not configured.' };
  }
  if (!online) {
    // Not an error worth alarming anyone with: the ops are queued locally and
    // will go up on the next round.
    return { ok: false, pushed: 0, pulled: [], seqByOpId: {}, error: 'You are offline.' };
  }

  try {
    const userId = await transport.currentUserId();
    if (!userId) {
      return { ok: false, pushed: 0, pulled: [], seqByOpId: {}, error: 'Sign in to sync.' };
    }

    const outgoing = pendingOps(localOps);
    const seqByOpId: Record<string, number> = {};

    if (outgoing.length > 0) {
      const acknowledged = await transport.push(outgoing.map((op) => toRemote(op, userId)));
      for (const row of acknowledged) seqByOpId[row.id] = row.server_seq;
    }

    const since = localOps.reduce(
      (max, op) => (op.serverSeq && op.serverSeq > max ? op.serverSeq : max),
      0,
    );
    const incoming = await transport.pull(userId, since, options.limit ?? 5000);

    const known = new Set(localOps.map((o) => o.id));
    const pulled = incoming.map(fromRemote).filter((op) => !known.has(op.id));

    return { ok: true, pushed: outgoing.length, pulled, seqByOpId };
  } catch (err) {
    return {
      ok: false,
      pushed: 0,
      pulled: [],
      seqByOpId: {},
      error: err instanceof Error ? err.message : 'Sync failed.',
    };
  }
}

/** The SQL a user runs once in their own Supabase project to enable sync. */
export const SCHEMA_SQL = `-- Pocketa sync: one append-only table, isolated per user.
create table if not exists public.ops (
  id           text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  server_seq   bigserial not null,
  device_id    text not null,
  lamport      bigint not null,
  created_at   timestamptz not null,
  type         text not null,
  entity       text not null,
  entity_id    text not null,
  summary      text not null,
  changes      jsonb,
  snapshot     jsonb
);

create index if not exists ops_user_seq_idx on public.ops (user_id, server_seq);

alter table public.ops enable row level security;

-- Each account can only ever see and write its own rows.
--
-- Every policy is dropped first, so pasting this a second time updates the
-- rules instead of failing on "policy already exists".
drop policy if exists "read own ops" on public.ops;
create policy "read own ops"   on public.ops for select using (auth.uid() = user_id);

drop policy if exists "insert own ops" on public.ops;
create policy "insert own ops" on public.ops for insert with check (auth.uid() = user_id);

-- Update exists only so that re-sending a push whose acknowledgement was lost
-- is a no-op instead of a duplicate-key error. It is NOT a way to edit history,
-- so the row must still belong to the caller both before and after.
drop policy if exists "update own ops" on public.ops;
create policy "update own ops" on public.ops
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- History is append-only: nothing may delete an op.
drop policy if exists "no deletes" on public.ops;
create policy "no deletes" on public.ops for delete using (false);

-- ...and nothing may rewrite one either.
--
-- Without this, "append-only" was only half true: deletes were refused, but an
-- update could blank the contents of any row and leave the id in place. A
-- client that repeats a push sends the same values, so a genuine retry passes
-- this untouched; anything that actually changes what happened is rejected.
create or replace function public.ops_are_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.id         is distinct from old.id
  or new.user_id    is distinct from old.user_id
  or new.device_id  is distinct from old.device_id
  or new.lamport    is distinct from old.lamport
  or new.created_at is distinct from old.created_at
  or new.type       is distinct from old.type
  or new.entity     is distinct from old.entity
  or new.entity_id  is distinct from old.entity_id
  or new.summary    is distinct from old.summary
  or new.changes    is distinct from old.changes
  or new.snapshot   is distinct from old.snapshot then
    raise exception 'ops are append-only: an entry cannot be rewritten once stored';
  end if;
  -- server_seq is assigned by the sequence and is never reissued on a repeat.
  new.server_seq := old.server_seq;
  return new;
end;
$$;

drop trigger if exists ops_immutable on public.ops;
create trigger ops_immutable
  before update on public.ops
  for each row execute function public.ops_are_immutable();
`;

export { mergeOps };
