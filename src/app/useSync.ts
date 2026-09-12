/**
 * Keeping an account's devices in step, without being asked.
 *
 * Sync used to be a button in Settings. That is not an account — it is a chore,
 * and one you have to remember on every device. Someone who signs in on a phone
 * and a laptop expects the two to agree, and expects that to be the app's job.
 *
 * So this runs quietly on four triggers, which between them cover how the app
 * is actually used:
 *
 *   - **on sign-in**, so a new device pulls a ledger down immediately
 *   - **after a change**, debounced, so a burst of edits is one push
 *   - **on coming back online**, because that is when a queued change can leave
 *   - **on returning to the app**, because the other device may have moved on
 *
 * Success is silent. A person who has to be told their data saved does not
 * trust that it saves. Only a lasting failure is worth their attention, and
 * even then the local ledger is untouched and complete — nothing is lost by a
 * sync that has not happened yet.
 *
 * The engine runs once, in the shell. Screens read the state; they do not each
 * start their own, which would mean two devices' worth of syncing from one tab.
 */

import * as React from 'react';
import { create } from 'zustand';
import { useStore } from '../store/useStore';
import { namespaceForUser } from '../data/db';
import { getSession, onAuthChange, syncConfigured, syncOnce } from '../data/sync';
import type { Session } from '@supabase/supabase-js';

export type SyncPhase =
  /** No Supabase in this build; the app is local-only by construction. */
  | 'unavailable'
  /** Signed out. Everything is on this device, which is a valid way to use it. */
  | 'local'
  | 'syncing'
  | 'synced'
  /** Signed in, but the last attempt did not get through. */
  | 'failed';

export interface SyncState {
  phase: SyncPhase;
  email: string | null;
  /** Changes authored here that the server has not acknowledged. */
  pending: number;
  lastSyncedAt: number | null;
  error: string | null;
  online: boolean;
  /** Rows carried up from this device's anonymous ledger when signing in. */
  adopted: number;
}

interface SyncStore extends SyncState {
  set(patch: Partial<SyncState>): void;
}

const useSyncStore = create<SyncStore>()((set) => ({
  phase: syncConfigured ? 'local' : 'unavailable',
  email: null,
  pending: 0,
  lastSyncedAt: null,
  error: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  adopted: 0,
  set: (patch) => set(patch),
}));

/** A burst of edits should be one push, not one per keystroke. */
const SETTLE_MS = 2500;

/** Returning to the app re-checks, but not more often than this. */
const REFOCUS_MS = 30_000;

/** Guards against a second engine if the shell ever remounts. */
let running = false;
let lastRunAt = 0;
let session: Session | null = null;

async function runSync(): Promise<void> {
  if (!syncConfigured || !session || running) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  running = true;
  lastRunAt = Date.now();
  const { set } = useSyncStore.getState();
  set({ phase: 'syncing' });

  try {
    const store = useStore.getState();
    const result = await syncOnce(store.ops);

    if (!result.ok) {
      set({ phase: 'failed', error: result.error ?? 'Could not reach your account just now.' });
      return;
    }

    const acknowledged = Object.keys(result.seqByOpId);
    if (acknowledged.length > 0) await store.markOpsSynced(acknowledged, result.seqByOpId);
    if (result.pulled.length > 0) await store.ingestRemoteOps(result.pulled);

    set({ phase: 'synced', error: null, lastSyncedAt: Date.now() });
  } catch (err) {
    set({
      phase: 'failed',
      error: err instanceof Error ? err.message : 'Could not reach your account just now.',
    });
  } finally {
    running = false;
  }
}

/**
 * Drives the engine. Called exactly once, from the shell.
 */
export function useSyncEngine(): void {
  const revision = useStore((s) => s.revision);
  const status = useStore((s) => s.status);
  const ops = useStore((s) => s.ops);
  const [account, setAccount] = React.useState<Session | null>(null);
  const set = useSyncStore((s) => s.set);

  // Anything unsent is worth showing, whether or not a sync is in flight.
  React.useEffect(() => {
    set({ pending: ops.filter((o) => o.synced === 0).length });
  }, [ops, set]);

  // --- the account ----------------------------------------------------------

  React.useEffect(() => {
    if (!syncConfigured) return;
    let cancelled = false;
    let unsubscribe = () => {};

    void (async () => {
      const found = await getSession();
      if (!cancelled) {
        session = found;
        setAccount(found);
      }
      unsubscribe = await onAuthChange((next) => {
        if (cancelled) return;
        session = next;
        setAccount(next);
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  /**
   * Point the store at the right database whenever the account changes.
   *
   * This lived in the Settings screen, which meant it only happened if you were
   * looking at it. Signing in anywhere has to move the whole app.
   */
  React.useEffect(() => {
    if (!syncConfigured) return;

    const wanted = namespaceForUser(account?.user.id ?? null);
    set({ email: account?.user.email ?? null });

    if (!account) {
      set({ phase: 'local', error: null });
    }
    if (useStore.getState().namespace === wanted) return;

    void (async () => {
      const carried = await useStore.getState().switchAccount(account?.user.id ?? null);
      if (carried > 0) set({ adopted: carried });
    })();
  }, [account, set]);

  /** On sign-in, and after every change once it has settled. */
  React.useEffect(() => {
    if (!account || status !== 'ready') return;
    const first = useSyncStore.getState().lastSyncedAt === null;
    const timer = setTimeout(() => void runSync(), first ? 0 : SETTLE_MS);
    return () => clearTimeout(timer);
  }, [account, status, revision]);

  /** Coming back online, and coming back to the app. */
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const goOnline = () => {
      set({ online: true });
      void runSync();
    };
    const goOffline = () => set({ online: false });
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRunAt < REFOCUS_MS) return;
      void runSync();
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [set]);
}

/** Read the state. Safe to call from anywhere, as often as you like. */
export function useSync(): SyncState & { syncNow: () => void } {
  const state = useSyncStore();
  return {
    phase: state.phase,
    email: state.email,
    pending: state.pending,
    lastSyncedAt: state.lastSyncedAt,
    error: state.error,
    online: state.online,
    adopted: state.adopted,
    syncNow: () => void runSync(),
  };
}

/** Plain words for a state, rather than a spinner nobody can interpret. */
export function describeSync(state: SyncState, now = Date.now()): string {
  switch (state.phase) {
    case 'unavailable':
      return 'Saved on this device';
    case 'local':
      return 'Saved on this device only';
    case 'syncing':
      return 'Syncing…';
    case 'failed':
      return state.online ? 'Could not reach your account' : 'Offline — will sync later';
    case 'synced': {
      if (state.pending > 0) return `${state.pending} waiting to sync`;
      if (state.lastSyncedAt == null) return 'Synced';
      const seconds = Math.max(0, Math.round((now - state.lastSyncedAt) / 1000));
      if (seconds < 60) return 'Synced just now';
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return `Synced ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
      const hours = Math.round(minutes / 60);
      return `Synced ${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
  }
}
