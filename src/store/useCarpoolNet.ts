/**
 * The carpool network store.
 *
 * Kept apart from the ledger store on purpose. The ledger is local-first and
 * private; this is shared and needs connectivity to mean anything. Mixing them
 * would put a network failure in the path of recording an expense.
 *
 * It picks its own backend: a Supabase project when one is configured and
 * signed in, otherwise a local store that keeps the single-user flow working.
 */

import { create } from 'zustand';
import { nowIso, today } from '../core/dates';
import { newId } from '../core/ids';
import {
  activeMembers,
  canLogRide,
  canManageTeam,
  canSeePhone,
  canSeeTeamRides,
  isDriverOf,
  membershipOf,
  pendingRequests,
  type CarpoolProfile,
  type CarpoolTeam,
  type MembershipStatus,
  type TeamMembership,
  type TeamRole,
} from '../core/carpoolNetwork';
import type { CarpoolRoute } from '../core/carpoolMatch';
import {
  EMPTY_WORLD,
  LOCAL_USER_ID,
  emptyLocalStore,
  localNetwork,
  seatsTaken,
  supabaseNetwork,
  type CarpoolNetwork,
  type CarpoolWorld,
  type LocalStore,
  type SharedRide,
} from '../data/carpoolNet';
import { getDb } from '../data/db';
import { useStore } from './useStore';
import type { ID } from '../core/types';

const LOCAL_KEY = 'carpoolNetwork';

/** Local persistence rides in the existing `meta` table: no migration needed. */
function localPersistence() {
  return {
    async read(): Promise<LocalStore> {
      const row = await getDb(useStore.getState().namespace).meta.get(LOCAL_KEY);
      return (row?.value as LocalStore) ?? emptyLocalStore();
    },
    async write(store: LocalStore) {
      await getDb(useStore.getState().namespace).meta.put({ key: LOCAL_KEY, value: store });
    },
  };
}

export type NetStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CarpoolNetState {
  status: NetStatus;
  /**
   * True while re-reading after a change, as distinct from the first load.
   *
   * They must be distinguishable: blanking the screen for a refresh unmounts
   * whatever sheet is open, so saving a route or accepting a passenger looked
   * like the dialog had crashed.
   */
  refreshing: boolean;
  error: string | null;
  /** Which backend answered. */
  kind: 'local' | 'supabase';
  userId: ID | null;
  world: CarpoolWorld;
  /** Routes found by the last search, and the teams behind them. */
  discovered: { routes: CarpoolRoute[]; teams: CarpoolTeam[]; drivers: CarpoolProfile[] };
}

export interface CarpoolNetActions {
  refresh(): Promise<void>;

  saveProfile(input: { displayName: string; defaultRole: TeamRole }): Promise<void>;
  savePhone(phone: string | null): Promise<void>;

  createTeam(input: { name: string; ratePerTrip: number; currency: string }): Promise<CarpoolTeam | null>;
  updateTeam(team: CarpoolTeam): Promise<void>;
  saveRoute(route: CarpoolRoute): Promise<void>;

  createInvite(teamId: ID): Promise<string | null>;
  revokeInvite(inviteId: ID): Promise<void>;
  redeemInvite(token: string): Promise<{ ok: boolean; error?: string }>;

  requestJoin(teamId: ID, message: string | null): Promise<{ ok: boolean; error?: string }>;
  decideMembership(membershipId: ID, status: MembershipStatus): Promise<void>;
  leaveTeam(teamId: ID): Promise<void>;

  loadDiscovery(): Promise<void>;

  logRide(input: { teamId: ID; date: string; riderUserIds: ID[]; note?: string | null; id?: ID }): Promise<void>;
  deleteRide(rideId: ID): Promise<void>;

  // --- questions the screens ask ---
  myTeams(): CarpoolTeam[];
  teamsIDrive(): CarpoolTeam[];
  teamsIRideIn(): CarpoolTeam[];
  routeFor(teamId: ID): CarpoolRoute | undefined;
  ridesFor(teamId: ID): SharedRide[];
  membersOf(teamId: ID): Array<{ membership: TeamMembership; profile: CarpoolProfile | undefined }>;
  requestsFor(teamId: ID): Array<{ membership: TeamMembership; profile: CarpoolProfile | undefined }>;
  phoneOf(userId: ID): string | null;
  nameOf(userId: ID): string;
  canManage(teamId: ID): boolean;
  canLog(teamId: ID): boolean;
  canSee(teamId: ID): boolean;
  freeSeats(teamId: ID): number;
}

export type CarpoolNetStore = CarpoolNetState & CarpoolNetActions;

/** Whichever backend is available right now. */
async function pickNetwork(): Promise<CarpoolNetwork> {
  const remote = await supabaseNetwork();
  if (remote && (await remote.currentUserId())) return remote;
  return localNetwork(localPersistence());
}

export const useCarpoolNet = create<CarpoolNetStore>()((set, get) => ({
  status: 'idle',
  refreshing: false,
  error: null,
  kind: 'local',
  userId: null,
  world: EMPTY_WORLD,
  discovered: { routes: [], teams: [], drivers: [] },

  async refresh() {
    const first = get().status !== 'ready';
    set(first ? { status: 'loading', error: null } : { refreshing: true, error: null });
    try {
      const net = await pickNetwork();
      const [world, userId] = await Promise.all([net.load(), net.currentUserId()]);
      set({ status: 'ready', refreshing: false, kind: net.kind, world, userId });
    } catch (err) {
      set({
        // A failed refresh keeps whatever was on screen rather than replacing
        // a working view with an error.
        status: first ? 'error' : 'ready',
        refreshing: false,
        error: err instanceof Error ? err.message : 'The carpool network could not be reached.',
      });
    }
  },

  async saveProfile(input) {
    const net = await pickNetwork();
    await net.saveProfile(input);
    await get().refresh();
  },

  async savePhone(phone) {
    const net = await pickNetwork();
    await net.savePhone(phone);
    await get().refresh();
  },

  async createTeam(input) {
    const net = await pickNetwork();
    const team = await net.createTeam(input);
    await get().refresh();
    return team;
  },

  async updateTeam(team) {
    const net = await pickNetwork();
    await net.updateTeam(team);
    await get().refresh();
  },

  async saveRoute(route) {
    const net = await pickNetwork();
    await net.saveRoute(route);
    await get().refresh();
  },

  async createInvite(teamId) {
    const net = await pickNetwork();
    const invite = await net.createInvite(teamId);
    await get().refresh();
    return invite.token;
  },

  async revokeInvite(inviteId) {
    const net = await pickNetwork();
    await net.revokeInvite(inviteId);
    await get().refresh();
  },

  async redeemInvite(token) {
    const net = await pickNetwork();
    const result = await net.redeemInvite(token);
    if (result.ok) await get().refresh();
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },

  async requestJoin(teamId, message) {
    const net = await pickNetwork();
    const result = await net.requestJoin(teamId, message);
    if (result.ok) await get().refresh();
    return result;
  },

  async decideMembership(membershipId, status) {
    const net = await pickNetwork();
    await net.decideMembership(membershipId, status);
    await get().refresh();
  },

  async leaveTeam(teamId) {
    const net = await pickNetwork();
    await net.leaveTeam(teamId);
    await get().refresh();
  },

  async loadDiscovery() {
    const net = await pickNetwork();
    set({ discovered: await net.discoverRoutes() });
  },

  async logRide(input) {
    const net = await pickNetwork();
    const { world, userId } = get();
    const team = world.teams.find((t) => t.id === input.teamId);

    const ride: SharedRide = {
      id: input.id ?? newId('txn'),
      teamId: input.teamId,
      date: input.date,
      riderUserIds: input.riderUserIds,
      // Frozen, so changing the rate later never re-prices a past month.
      rateSnapshot: team?.ratePerTrip ?? 0,
      note: input.note ?? null,
      loggedBy: userId ?? LOCAL_USER_ID,
      settledAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await net.logRide(ride);
    await get().refresh();
  },

  async deleteRide(rideId) {
    const net = await pickNetwork();
    await net.deleteRide(rideId);
    await get().refresh();
  },

  // -------------------------------------------------------------------------

  myTeams() {
    const { world, userId } = get();
    if (!userId) return [];
    return world.teams.filter(
      (t) => membershipOf(world.memberships, t.id, userId)?.status === 'active',
    );
  },

  teamsIDrive() {
    const { userId } = get();
    return userId ? get().myTeams().filter((t) => isDriverOf(t, userId)) : [];
  },

  teamsIRideIn() {
    const { userId } = get();
    return userId ? get().myTeams().filter((t) => !isDriverOf(t, userId)) : [];
  },

  routeFor(teamId) {
    return get().world.routes.find((r) => r.teamId === teamId);
  },

  ridesFor(teamId) {
    return get()
      .world.rides.filter((r) => r.teamId === teamId)
      .sort((a, b) => b.date.localeCompare(a.date));
  },

  membersOf(teamId) {
    const { world } = get();
    return activeMembers(world.memberships, teamId).map((membership) => ({
      membership,
      profile: world.people.find((p) => p.userId === membership.userId),
    }));
  },

  requestsFor(teamId) {
    const { world } = get();
    return pendingRequests(world.memberships, teamId).map((membership) => ({
      membership,
      profile: world.people.find((p) => p.userId === membership.userId),
    }));
  },

  /** Null unless the rules say this viewer may have it. */
  phoneOf(subjectId) {
    const { world, userId } = get();
    if (!userId) return null;
    if (!canSeePhone(userId, subjectId, world.teams, world.memberships)) return null;
    return world.contacts[subjectId] ?? null;
  },

  nameOf(subjectId) {
    const { world } = get();
    if (subjectId === get().userId) return world.me?.displayName ?? 'You';
    return world.people.find((p) => p.userId === subjectId)?.displayName ?? 'Someone';
  },

  canManage(teamId) {
    const { world, userId } = get();
    const team = world.teams.find((t) => t.id === teamId);
    return !!team && !!userId && canManageTeam(userId, team);
  },

  canLog(teamId) {
    const { world, userId } = get();
    const team = world.teams.find((t) => t.id === teamId);
    return !!team && !!userId && canLogRide(userId, team, world.memberships);
  },

  canSee(teamId) {
    const { world, userId } = get();
    const team = world.teams.find((t) => t.id === teamId);
    return !!team && !!userId && canSeeTeamRides(userId, team, world.memberships);
  },

  freeSeats(teamId) {
    const { world } = get();
    const route = world.routes.find((r) => r.teamId === teamId);
    if (!route) return 0;
    return Math.max(0, route.seatsTotal - seatsTaken(world.memberships, teamId));
  },
}));

export { today };
