/**
 * The shared half of carpooling: teams, membership, invites and discovery.
 *
 * This is a different kind of data from the ledger. Your money is yours alone —
 * local-first, private, synced only to your own account. A carpool team is by
 * definition shared, and a discoverable route is by definition public. Mixing
 * the two would mean the privacy rules for one leaked into the other, so they
 * live apart.
 *
 * The rules below are plain functions rather than checks scattered through the
 * UI, because "who may see this person's phone number" is exactly the kind of
 * question that must have one answer, written down, and tested.
 */

import type { CarpoolRoute } from './carpoolMatch';
import type { ID, ISOTimestamp } from './types';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type TeamRole = 'driver' | 'passenger';

/**
 * Membership status.
 *
 * `requested` and `invited` are both pending, but they differ in who initiated
 * it — which matters, because a person who asked to join has consented to being
 * contacted in a way that someone merely invited has not yet.
 */
export type MembershipStatus = 'invited' | 'requested' | 'active' | 'declined' | 'removed';

export interface CarpoolProfile {
  userId: ID;
  displayName: string;
  /**
   * E.164, e.g. +923001234567.
   *
   * Collected at sign-up so teammates can reach each other, and released only
   * under the rules in `canSeePhone`. It is never included in a public listing.
   */
  phone: string | null;
  /** What this person mostly does. A driver on one team can ride on another. */
  defaultRole: TeamRole;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface CarpoolTeam {
  id: ID;
  name: string;
  /** The captain. Exactly one, and they are always an active member. */
  driverUserId: ID;
  routeId: ID | null;
  ratePerTrip: number;
  currency: string;
  /** Listed in public route search. Off means invite-only. */
  discoverable: boolean;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface TeamMembership {
  id: ID;
  teamId: ID;
  userId: ID;
  role: TeamRole;
  status: MembershipStatus;
  /** Free text from a requester: "I live near Nazimabad, weekdays only". */
  message: string | null;
  requestedAt: ISOTimestamp | null;
  joinedAt: ISOTimestamp | null;
  updatedAt: ISOTimestamp;
}

export interface CarpoolInvite {
  id: ID;
  teamId: ID;
  /** The opaque part of the shareable link. */
  token: string;
  createdBy: ID;
  expiresAt: ISOTimestamp | null;
  /** Null means unlimited. */
  maxUses: number | null;
  uses: number;
  revoked: boolean;
  createdAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Membership questions
// ---------------------------------------------------------------------------

export function membershipOf(
  memberships: readonly TeamMembership[],
  teamId: ID,
  userId: ID,
): TeamMembership | undefined {
  return memberships.find((m) => m.teamId === teamId && m.userId === userId);
}

export function isActiveMember(
  memberships: readonly TeamMembership[],
  teamId: ID,
  userId: ID,
): boolean {
  return membershipOf(memberships, teamId, userId)?.status === 'active';
}

export function isDriverOf(team: CarpoolTeam, userId: ID): boolean {
  return team.driverUserId === userId;
}

export function activeMembers(
  memberships: readonly TeamMembership[],
  teamId: ID,
): TeamMembership[] {
  return memberships.filter((m) => m.teamId === teamId && m.status === 'active');
}

export function pendingRequests(
  memberships: readonly TeamMembership[],
  teamId: ID,
): TeamMembership[] {
  return memberships.filter((m) => m.teamId === teamId && m.status === 'requested');
}

// ---------------------------------------------------------------------------
// Who may see what
// ---------------------------------------------------------------------------

/**
 * May `viewer` see `subject`'s phone number?
 *
 * Only between people who are both active members of the same team — which
 * means both sides have consented: one asked or was invited, the other
 * accepted. Deliberately NOT visible on a pending request, because otherwise
 * anyone could stand up a fake team and harvest the numbers of everyone who
 * applied to it.
 *
 * You can always see your own.
 */
export function canSeePhone(
  viewerId: ID,
  subjectId: ID,
  teams: readonly CarpoolTeam[],
  memberships: readonly TeamMembership[],
): boolean {
  if (viewerId === subjectId) return true;

  return teams.some(
    (team) =>
      isActiveMember(memberships, team.id, viewerId) &&
      isActiveMember(memberships, team.id, subjectId),
  );
}

/** May `viewer` see the ride log of this team? Active members only. */
export function canSeeTeamRides(
  viewerId: ID,
  team: CarpoolTeam,
  memberships: readonly TeamMembership[],
): boolean {
  return isActiveMember(memberships, team.id, viewerId);
}

/**
 * May `viewer` log a ride for this team?
 *
 * Any active member, driver or passenger — the point of letting passengers log
 * is that the driver stops being the only person who has to remember.
 */
export function canLogRide(
  viewerId: ID,
  team: CarpoolTeam,
  memberships: readonly TeamMembership[],
): boolean {
  return isActiveMember(memberships, team.id, viewerId);
}

/** Only the captain admits, removes, sets the rate, or bills. */
export function canManageTeam(viewerId: ID, team: CarpoolTeam): boolean {
  return isDriverOf(team, viewerId);
}

/**
 * A passenger may correct a ride they logged; the driver may correct any.
 *
 * Otherwise one passenger could quietly delete another's trips and change what
 * everyone owes.
 */
export function canEditRide(
  viewerId: ID,
  team: CarpoolTeam,
  loggedByUserId: ID,
): boolean {
  return isDriverOf(team, viewerId) || viewerId === loggedByUserId;
}

// ---------------------------------------------------------------------------
// Public listings
// ---------------------------------------------------------------------------

/**
 * What a stranger sees when a route turns up in search.
 *
 * No phone number, no passenger names, no home addresses — only the driver's
 * display name and the route they chose to publish. Contact happens after a
 * request is accepted, never before.
 */
export interface PublicListing {
  teamId: ID;
  teamName: string;
  driverName: string;
  route: CarpoolRoute;
  seatsFree: number;
  ratePerTrip: number;
  currency: string;
  /** Whether the viewer already has a pending or active relationship. */
  viewerStatus: MembershipStatus | 'none';
}

export function toPublicListing(input: {
  team: CarpoolTeam;
  route: CarpoolRoute;
  driver: CarpoolProfile;
  memberships: readonly TeamMembership[];
  viewerId: ID | null;
}): PublicListing {
  const { team, route, driver, memberships, viewerId } = input;
  const active = activeMembers(memberships, team.id).length;

  return {
    teamId: team.id,
    teamName: team.name,
    // Name only. The phone is not read here at all, so it cannot leak by
    // someone later widening this object.
    driverName: driver.displayName,
    route,
    seatsFree: Math.max(0, route.seatsTotal - Math.max(0, active - 1)),
    ratePerTrip: team.ratePerTrip,
    currency: team.currency,
    viewerStatus: viewerId
      ? (membershipOf(memberships, team.id, viewerId)?.status ?? 'none')
      : 'none',
  };
}

/** Only discoverable, active routes are searchable by strangers. */
export function listableRoutes(
  teams: readonly CarpoolTeam[],
  routes: readonly CarpoolRoute[],
): CarpoolRoute[] {
  const open = new Set(teams.filter((t) => t.discoverable).map((t) => t.id));
  return routes.filter((r) => open.has(r.teamId) && r.discoverable && r.active);
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/** Strip a number to digits and a leading +, for comparison and links. */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s()\-.]/g, '');
  if (!trimmed) return null;

  const withPlus = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
  if (!/^\+?\d{7,15}$/.test(withPlus)) return null;
  return withPlus.startsWith('+') ? withPlus : `+${withPlus}`;
}

export function isValidPhone(raw: string): boolean {
  return normalisePhone(raw) !== null;
}

/**
 * A WhatsApp deep link, or null when the viewer is not entitled to the number.
 *
 * Taking the entitlement check as an argument rather than a boolean flag means
 * a caller cannot accidentally build a link for a number they should not have.
 */
export function whatsappLink(phone: string | null, message?: string): string | null {
  if (!phone) return null;
  const normalised = normalisePhone(phone);
  if (!normalised) return null;

  const digits = normalised.replace(/^\+/, '');
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${digits}${text}`;
}

/** Masked for display where the number itself is not released. */
export function maskPhone(phone: string | null): string {
  const normalised = phone ? normalisePhone(phone) : null;
  if (!normalised) return '—';
  return `${normalised.slice(0, 4)} ••• ${normalised.slice(-3)}`;
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export type InviteProblem = 'unknown' | 'revoked' | 'expired' | 'used_up' | 'already_member';

export type InviteCheck =
  | { ok: true; invite: CarpoolInvite }
  | { ok: false; problem: InviteProblem; message: string };

/**
 * Validate a link before letting anyone through it.
 *
 * Every failure gets its own message, because "this link has expired" and
 * "you are already on this team" call for completely different next steps.
 */
export function checkInvite(
  token: string,
  invites: readonly CarpoolInvite[],
  memberships: readonly TeamMembership[],
  viewerId: ID | null,
  now: ISOTimestamp,
): InviteCheck {
  const invite = invites.find((i) => i.token === token);
  if (!invite) {
    return { ok: false, problem: 'unknown', message: 'That invite link is not valid.' };
  }
  if (invite.revoked) {
    return { ok: false, problem: 'revoked', message: 'The driver has cancelled this invite link.' };
  }
  if (invite.expiresAt && invite.expiresAt <= now) {
    return { ok: false, problem: 'expired', message: 'This invite link has expired. Ask the driver for a new one.' };
  }
  if (invite.maxUses != null && invite.uses >= invite.maxUses) {
    return { ok: false, problem: 'used_up', message: 'This invite link has already been used.' };
  }
  if (viewerId && isActiveMember(memberships, invite.teamId, viewerId)) {
    return { ok: false, problem: 'already_member', message: 'You are already on this team.' };
  }
  return { ok: true, invite };
}

/**
 * An unguessable token.
 *
 * From the platform CSPRNG rather than Math.random, since anyone who could
 * guess a token could join a stranger's team.
 */
export function newInviteToken(): string {
  const bytes = new Uint8Array(16);
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Base32-ish over an unambiguous alphabet: no O/0 or I/1 to misread aloud.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function inviteUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/#/join/${token}`;
}

/** Pull a token out of a pasted link or a typed code. */
export function parseInviteInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/\/join\/([A-Za-z0-9]+)/);
  const token = (fromUrl ? fromUrl[1] : trimmed).toUpperCase();
  return /^[A-Z2-9]{8,64}$/.test(token) ? token : null;
}
