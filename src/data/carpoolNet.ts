/**
 * Talking to the carpool network.
 *
 * Two implementations behind one interface:
 *
 *   - `localNetwork` keeps everything in IndexedDB. Single-user, but the whole
 *     driver-side flow works today: define a route, keep a team, log rides,
 *     bill at month end. It is also the test double.
 *   - `supabaseNetwork` is the real one. Invites, join requests and public
 *     search only mean anything once several people share a server.
 *
 * The seam exists for the same reason as the one in sync: the rules worth
 * testing are about who may see what, and those are decidable without a
 * network.
 */

import { nowIso } from '../core/dates';
import { newId } from '../core/ids';
import {
  activeMembers,
  checkInvite,
  newInviteToken,
  type CarpoolInvite,
  type CarpoolProfile,
  type CarpoolTeam,
  type MembershipStatus,
  type TeamMembership,
  type TeamRole,
} from '../core/carpoolNetwork';
import type { CarpoolRoute } from '../core/carpoolMatch';
import { getClient } from './sync';
import type { ID } from '../core/types';

/** One entry in the shared ride log. */
export interface SharedRide {
  id: ID;
  teamId: ID;
  date: string;
  riderUserIds: ID[];
  /** The rate in force when it was logged, frozen. */
  rateSnapshot: number;
  note: string | null;
  loggedBy: ID;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Everything the carpool screens need in one shape. */
export interface CarpoolWorld {
  me: CarpoolProfile | null;
  teams: CarpoolTeam[];
  routes: CarpoolRoute[];
  memberships: TeamMembership[];
  rides: SharedRide[];
  /** Profiles of everyone the viewer is entitled to see. */
  people: CarpoolProfile[];
  /** Phone numbers, keyed by user id, for those the viewer may contact. */
  contacts: Record<ID, string | null>;
  invites: CarpoolInvite[];
}

export const EMPTY_WORLD: CarpoolWorld = {
  me: null,
  teams: [],
  routes: [],
  memberships: [],
  rides: [],
  people: [],
  contacts: {},
  invites: [],
};

export interface CarpoolNetwork {
  readonly kind: 'local' | 'supabase';
  currentUserId(): Promise<ID | null>;

  load(): Promise<CarpoolWorld>;
  saveProfile(profile: Pick<CarpoolProfile, 'displayName' | 'defaultRole'>): Promise<void>;
  savePhone(phone: string | null): Promise<void>;

  createTeam(input: { name: string; ratePerTrip: number; currency: string }): Promise<CarpoolTeam>;
  updateTeam(team: CarpoolTeam): Promise<void>;

  saveRoute(route: CarpoolRoute): Promise<void>;

  createInvite(teamId: ID, opts?: { expiresAt?: string | null; maxUses?: number | null }): Promise<CarpoolInvite>;
  revokeInvite(inviteId: ID): Promise<void>;
  redeemInvite(token: string): Promise<{ ok: true; teamId: ID } | { ok: false; error: string }>;

  requestJoin(teamId: ID, message: string | null): Promise<{ ok: boolean; error?: string }>;
  decideMembership(membershipId: ID, status: MembershipStatus): Promise<void>;
  leaveTeam(teamId: ID): Promise<void>;

  /** Discoverable routes, for the search screen. */
  discoverRoutes(): Promise<{ routes: CarpoolRoute[]; teams: CarpoolTeam[]; drivers: CarpoolProfile[] }>;

  logRide(ride: SharedRide): Promise<void>;
  deleteRide(rideId: ID): Promise<void>;
}

// ===========================================================================
// Local
// ===========================================================================

/**
 * The single-user implementation.
 *
 * Its user id is a stable local constant, so everything the driver does is
 * attributed consistently and the same authorisation rules apply unchanged.
 */
export const LOCAL_USER_ID = 'local-user';

export interface LocalStore {
  profile: CarpoolProfile | null;
  phone: string | null;
  teams: CarpoolTeam[];
  routes: CarpoolRoute[];
  memberships: TeamMembership[];
  rides: SharedRide[];
  invites: CarpoolInvite[];
}

export function emptyLocalStore(): LocalStore {
  return { profile: null, phone: null, teams: [], routes: [], memberships: [], rides: [], invites: [] };
}

export interface LocalPersistence {
  read(): Promise<LocalStore>;
  write(store: LocalStore): Promise<void>;
}

export function localNetwork(persistence: LocalPersistence): CarpoolNetwork {
  const mutate = async (fn: (s: LocalStore) => void) => {
    const store = await persistence.read();
    fn(store);
    await persistence.write(store);
  };

  return {
    kind: 'local',

    async currentUserId() {
      return LOCAL_USER_ID;
    },

    async load() {
      const s = await persistence.read();
      return {
        me: s.profile,
        teams: s.teams,
        routes: s.routes,
        memberships: s.memberships,
        rides: s.rides,
        people: s.profile ? [s.profile] : [],
        contacts: { [LOCAL_USER_ID]: s.phone },
        invites: s.invites,
      };
    },

    async saveProfile(input) {
      await mutate((s) => {
        s.profile = {
          userId: LOCAL_USER_ID,
          displayName: input.displayName,
          defaultRole: input.defaultRole,
          createdAt: s.profile?.createdAt ?? nowIso(),
          updatedAt: nowIso(),
          phone: null,
        };
      });
    },

    async savePhone(phone) {
      await mutate((s) => {
        s.phone = phone;
      });
    },

    async createTeam(input) {
      const team: CarpoolTeam = {
        id: newId('acc'),
        name: input.name,
        driverUserId: LOCAL_USER_ID,
        routeId: null,
        ratePerTrip: input.ratePerTrip,
        currency: input.currency,
        discoverable: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await mutate((s) => {
        s.teams.push(team);
        // The captain is always an active member of their own team.
        s.memberships.push({
          id: newId('per'),
          teamId: team.id,
          userId: LOCAL_USER_ID,
          role: 'driver',
          status: 'active',
          message: null,
          requestedAt: nowIso(),
          joinedAt: nowIso(),
          updatedAt: nowIso(),
        });
      });
      return team;
    },

    async updateTeam(team) {
      await mutate((s) => {
        s.teams = s.teams.map((t) => (t.id === team.id ? { ...team, updatedAt: nowIso() } : t));
      });
    },

    async saveRoute(route) {
      await mutate((s) => {
        const exists = s.routes.some((r) => r.id === route.id);
        s.routes = exists ? s.routes.map((r) => (r.id === route.id ? route : r)) : [...s.routes, route];
        s.teams = s.teams.map((t) => (t.id === route.teamId ? { ...t, routeId: route.id } : t));
      });
    },

    async createInvite(teamId, opts) {
      const invite: CarpoolInvite = {
        id: newId('per'),
        teamId,
        token: newInviteToken(),
        createdBy: LOCAL_USER_ID,
        expiresAt: opts?.expiresAt ?? null,
        maxUses: opts?.maxUses ?? null,
        uses: 0,
        revoked: false,
        createdAt: nowIso(),
      };
      await mutate((s) => void s.invites.push(invite));
      return invite;
    },

    async revokeInvite(inviteId) {
      await mutate((s) => {
        s.invites = s.invites.map((i) => (i.id === inviteId ? { ...i, revoked: true } : i));
      });
    },

    async redeemInvite(token) {
      const s = await persistence.read();
      const check = checkInvite(token, s.invites, s.memberships, LOCAL_USER_ID, nowIso());
      if (!check.ok) return { ok: false, error: check.message };
      // On one device there is nobody else to become; the link is valid but
      // there is no second account to attach.
      return { ok: false, error: 'Invite links need an account. Sign in to join someone’s team.' };
    },

    async requestJoin() {
      return { ok: false, error: 'Sign in to ask a driver to add you.' };
    },

    async decideMembership(membershipId, status) {
      await mutate((s) => {
        s.memberships = s.memberships.map((m) =>
          m.id === membershipId
            ? { ...m, status, joinedAt: status === 'active' ? (m.joinedAt ?? nowIso()) : m.joinedAt, updatedAt: nowIso() }
            : m,
        );
      });
    },

    async leaveTeam(teamId) {
      await mutate((s) => {
        s.memberships = s.memberships.map((m) =>
          m.teamId === teamId && m.userId === LOCAL_USER_ID
            ? { ...m, status: 'removed', updatedAt: nowIso() }
            : m,
        );
      });
    },

    async discoverRoutes() {
      // Nothing to discover on one device: discovery is other people.
      return { routes: [], teams: [], drivers: [] };
    },

    async logRide(ride) {
      await mutate((s) => {
        const exists = s.rides.some((r) => r.id === ride.id);
        s.rides = exists ? s.rides.map((r) => (r.id === ride.id ? ride : r)) : [...s.rides, ride];
      });
    },

    async deleteRide(rideId) {
      await mutate((s) => {
        s.rides = s.rides.filter((r) => r.id !== rideId);
      });
    },
  };
}

// ===========================================================================
// Supabase
// ===========================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const toRoute = (r: Row): CarpoolRoute => ({
  id: r.id,
  teamId: r.team_id,
  name: r.name,
  path: r.path ?? [],
  days: r.days ?? [],
  departure: r.departure,
  pickupRadiusMetres: r.pickup_radius_metres,
  seatsTotal: r.seats_total,
  seatsTaken: r.seats_taken ?? 0,
  discoverable: r.discoverable,
  active: r.active,
});

const fromRoute = (r: CarpoolRoute): Row => ({
  id: r.id,
  team_id: r.teamId,
  name: r.name,
  path: r.path,
  days: r.days,
  departure: r.departure,
  pickup_radius_metres: r.pickupRadiusMetres,
  seats_total: r.seatsTotal,
  discoverable: r.discoverable,
  active: r.active,
  updated_at: nowIso(),
});

const toTeam = (r: Row): CarpoolTeam => ({
  id: r.id,
  name: r.name,
  driverUserId: r.driver_user_id,
  routeId: r.route_id ?? null,
  ratePerTrip: Number(r.rate_per_trip ?? 0),
  currency: r.currency ?? 'PKR',
  discoverable: r.discoverable,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toMembership = (r: Row): TeamMembership => ({
  id: r.id,
  teamId: r.team_id,
  userId: r.user_id,
  role: r.role as TeamRole,
  status: r.status as MembershipStatus,
  message: r.message ?? null,
  requestedAt: r.requested_at ?? null,
  joinedAt: r.joined_at ?? null,
  updatedAt: r.updated_at,
});

const toProfile = (r: Row): CarpoolProfile => ({
  userId: r.user_id,
  displayName: r.display_name,
  phone: null, // never carried on a profile row; contacts is a separate table
  defaultRole: r.default_role as TeamRole,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toRide = (r: Row): SharedRide => ({
  id: r.id,
  teamId: r.team_id,
  date: r.ride_date,
  riderUserIds: r.rider_user_ids ?? [],
  rateSnapshot: Number(r.rate_snapshot ?? 0),
  note: r.note ?? null,
  loggedBy: r.logged_by,
  settledAt: r.settled_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function supabaseNetwork(): Promise<CarpoolNetwork | null> {
  const db = await getClient();
  if (!db) return null;

  const userId = async () => (await db.auth.getSession()).data.session?.user.id ?? null;

  return {
    kind: 'supabase',
    currentUserId: userId,

    async load() {
      const me = await userId();
      if (!me) return EMPTY_WORLD;

      // Row-level security does the filtering; the client simply asks.
      const [profiles, contacts, teams, routes, memberships, rides, invites] = await Promise.all([
        db.from('carpool_profiles').select('*'),
        db.from('carpool_contacts').select('*'),
        db.from('carpool_teams').select('*'),
        db.from('carpool_routes').select('*'),
        db.from('team_memberships').select('*'),
        db.from('carpool_rides').select('*').order('ride_date', { ascending: false }),
        db.from('carpool_invites').select('*'),
      ]);

      const people = (profiles.data ?? []).map(toProfile);
      return {
        me: people.find((p) => p.userId === me) ?? null,
        teams: (teams.data ?? []).map(toTeam),
        routes: (routes.data ?? []).map(toRoute),
        memberships: (memberships.data ?? []).map(toMembership),
        rides: (rides.data ?? []).map(toRide),
        people,
        contacts: Object.fromEntries(
          (contacts.data ?? []).map((c: Row) => [c.user_id, c.phone ?? null]),
        ),
        invites: (invites.data ?? []).map((i: Row) => ({
          id: i.id,
          teamId: i.team_id,
          token: i.token,
          createdBy: i.created_by,
          expiresAt: i.expires_at ?? null,
          maxUses: i.max_uses ?? null,
          uses: i.uses,
          revoked: i.revoked,
          createdAt: i.created_at,
        })),
      };
    },

    async saveProfile(input) {
      const me = await userId();
      if (!me) throw new Error('Sign in first');
      const { error } = await db.from('carpool_profiles').upsert({
        user_id: me,
        display_name: input.displayName,
        default_role: input.defaultRole,
        updated_at: nowIso(),
      });
      if (error) throw new Error(error.message);
    },

    async savePhone(phone) {
      const me = await userId();
      if (!me) throw new Error('Sign in first');
      const { error } = await db
        .from('carpool_contacts')
        .upsert({ user_id: me, phone, updated_at: nowIso() });
      if (error) throw new Error(error.message);
    },

    async createTeam(input) {
      const me = await userId();
      if (!me) throw new Error('Sign in first');

      const { data, error } = await db
        .from('carpool_teams')
        .insert({
          name: input.name,
          driver_user_id: me,
          rate_per_trip: input.ratePerTrip,
          currency: input.currency,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);

      await db.from('team_memberships').insert({
        team_id: data.id,
        user_id: me,
        role: 'driver',
        status: 'active',
        joined_at: nowIso(),
      });
      return toTeam(data);
    },

    async updateTeam(team) {
      const { error } = await db
        .from('carpool_teams')
        .update({
          name: team.name,
          rate_per_trip: team.ratePerTrip,
          currency: team.currency,
          discoverable: team.discoverable,
          updated_at: nowIso(),
        })
        .eq('id', team.id);
      if (error) throw new Error(error.message);
    },

    async saveRoute(route) {
      const { error } = await db.from('carpool_routes').upsert(fromRoute(route));
      if (error) throw new Error(error.message);
    },

    async createInvite(teamId, opts) {
      const me = await userId();
      if (!me) throw new Error('Sign in first');

      const { data, error } = await db
        .from('carpool_invites')
        .insert({
          team_id: teamId,
          token: newInviteToken(),
          created_by: me,
          expires_at: opts?.expiresAt ?? null,
          max_uses: opts?.maxUses ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);

      return {
        id: data.id,
        teamId: data.team_id,
        token: data.token,
        createdBy: data.created_by,
        expiresAt: data.expires_at ?? null,
        maxUses: data.max_uses ?? null,
        uses: data.uses,
        revoked: data.revoked,
        createdAt: data.created_at,
      };
    },

    async revokeInvite(inviteId) {
      const { error } = await db.from('carpool_invites').update({ revoked: true }).eq('id', inviteId);
      if (error) throw new Error(error.message);
    },

    async redeemInvite(token) {
      // A function call, not a table read: the token is proven, never listed.
      const { data, error } = await db.rpc('redeem_carpool_invite', { invite_token: token });
      if (error) return { ok: false, error: error.message };
      return { ok: true, teamId: data as ID };
    },

    async requestJoin(teamId, message) {
      const me = await userId();
      if (!me) return { ok: false, error: 'Sign in to ask a driver to add you.' };

      const { error } = await db.from('team_memberships').insert({
        team_id: teamId,
        user_id: me,
        role: 'passenger',
        status: 'requested',
        message,
        requested_at: nowIso(),
      });
      if (error) {
        return {
          ok: false,
          error: /duplicate|unique/i.test(error.message)
            ? 'You have already asked to join this team.'
            : error.message,
        };
      }
      return { ok: true };
    },

    async decideMembership(membershipId, status) {
      // `joined_at` is only ever written when someone is admitted. Clearing it
      // on a decline or a removal would erase when they were on the team, which
      // is the one thing a past membership is for.
      const patch: Record<string, unknown> = { status, updated_at: nowIso() };
      if (status === 'active') patch.joined_at = nowIso();

      const { error } = await db.from('team_memberships').update(patch).eq('id', membershipId);
      if (error) throw new Error(error.message);
    },

    async leaveTeam(teamId) {
      const me = await userId();
      if (!me) return;
      const { error } = await db
        .from('team_memberships')
        .update({ status: 'removed', updated_at: nowIso() })
        .eq('team_id', teamId)
        .eq('user_id', me);
      if (error) throw new Error(error.message);
    },

    async discoverRoutes() {
      // RLS returns only discoverable rows, so this is safe to ask openly.
      // At larger scale this wants a bounding-box filter server-side; matching
      // stays client-side for now, which is honest at neighbourhood volumes.
      const [routes, teams, profiles] = await Promise.all([
        db.from('carpool_routes').select('*').eq('discoverable', true).eq('active', true).limit(500),
        db.from('carpool_teams').select('*').eq('discoverable', true).limit(500),
        db.from('carpool_profiles').select('*').limit(500),
      ]);
      return {
        routes: (routes.data ?? []).map(toRoute),
        teams: (teams.data ?? []).map(toTeam),
        drivers: (profiles.data ?? []).map(toProfile),
      };
    },

    async logRide(ride) {
      const { error } = await db.from('carpool_rides').upsert({
        id: ride.id,
        team_id: ride.teamId,
        ride_date: ride.date,
        rider_user_ids: ride.riderUserIds,
        rate_snapshot: ride.rateSnapshot,
        note: ride.note,
        logged_by: ride.loggedBy,
        updated_at: nowIso(),
      });
      if (error) throw new Error(error.message);
    },

    async deleteRide(rideId) {
      const { error } = await db.from('carpool_rides').delete().eq('id', rideId);
      if (error) throw new Error(error.message);
    },
  };
}

/** Seats a route has free right now, from the team's active passengers. */
export function seatsTaken(memberships: readonly TeamMembership[], teamId: ID): number {
  // The driver occupies no passenger seat.
  return Math.max(0, activeMembers(memberships, teamId).length - 1);
}
