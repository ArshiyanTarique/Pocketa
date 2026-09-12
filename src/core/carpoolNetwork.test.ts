import { describe, it, expect } from 'vitest';
import {
  canSeePhone,
  canSeeTeamRides,
  canLogRide,
  canManageTeam,
  canEditRide,
  isActiveMember,
  activeMembers,
  pendingRequests,
  toPublicListing,
  listableRoutes,
  normalisePhone,
  isValidPhone,
  whatsappLink,
  maskPhone,
  checkInvite,
  newInviteToken,
  inviteUrl,
  parseInviteInput,
  type CarpoolInvite,
  type CarpoolProfile,
  type CarpoolTeam,
  type TeamMembership,
} from './carpoolNetwork';
import type { CarpoolRoute } from './carpoolMatch';

const NOW = '2026-09-07T08:00:00.000Z';

function team(over: Partial<CarpoolTeam> = {}): CarpoolTeam {
  return {
    id: 'team_1',
    name: 'NED morning run',
    driverUserId: 'user_driver',
    routeId: 'route_1',
    ratePerTrip: 15000,
    currency: 'PKR',
    discoverable: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function member(over: Partial<TeamMembership> = {}): TeamMembership {
  return {
    id: `mem_${over.userId ?? 'x'}_${over.teamId ?? 'team_1'}`,
    teamId: 'team_1',
    userId: 'user_a',
    role: 'passenger',
    status: 'active',
    message: null,
    requestedAt: NOW,
    joinedAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function profile(over: Partial<CarpoolProfile> = {}): CarpoolProfile {
  return {
    userId: 'user_driver',
    displayName: 'Youshay',
    phone: '+923001234567',
    defaultRole: 'driver',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function route(over: Partial<CarpoolRoute> = {}): CarpoolRoute {
  return {
    id: 'route_1',
    teamId: 'team_1',
    name: 'Morning run',
    path: [
      { lat: 24.9089, lng: 67.0353, name: 'Nazimabad' },
      { lat: 24.9333, lng: 67.1103, name: 'NED University' },
    ],
    days: [1, 2, 3, 4, 5],
    departure: '07:30',
    pickupRadiusMetres: 1500,
    seatsTotal: 4,
    seatsTaken: 0,
    discoverable: true,
    active: true,
    ...over,
  };
}

// ===========================================================================
describe('who may see a phone number', () => {
  const teams = [team()];
  const driver = member({ userId: 'user_driver', role: 'driver', status: 'active' });
  const rider = member({ userId: 'user_rider', status: 'active' });

  it('lets two active teammates see each other', () => {
    const memberships = [driver, rider];
    expect(canSeePhone('user_driver', 'user_rider', teams, memberships)).toBe(true);
    expect(canSeePhone('user_rider', 'user_driver', teams, memberships)).toBe(true);
  });

  it('lets two passengers on the same team see each other', () => {
    const second = member({ userId: 'user_rider_2', status: 'active' });
    const memberships = [driver, rider, second];
    expect(canSeePhone('user_rider', 'user_rider_2', teams, memberships)).toBe(true);
  });

  it('always lets someone see their own', () => {
    expect(canSeePhone('user_x', 'user_x', [], [])).toBe(true);
  });

  it('hides a requester from the driver until the request is accepted', () => {
    // The attack this prevents: stand up a fake team, collect the phone number
    // of everyone who applies. Consent has to be mutual.
    const applicant = member({ userId: 'user_applicant', status: 'requested', joinedAt: null });
    const memberships = [driver, applicant];
    expect(canSeePhone('user_driver', 'user_applicant', teams, memberships)).toBe(false);
  });

  it('hides an invited person until they actually join', () => {
    const invited = member({ userId: 'user_invited', status: 'invited', joinedAt: null });
    expect(canSeePhone('user_driver', 'user_invited', teams, [driver, invited])).toBe(false);
  });

  it('hides a removed member again', () => {
    const removed = member({ userId: 'user_gone', status: 'removed' });
    expect(canSeePhone('user_driver', 'user_gone', teams, [driver, removed])).toBe(false);
  });

  it('hides a declined applicant', () => {
    const declined = member({ userId: 'user_no', status: 'declined' });
    expect(canSeePhone('user_driver', 'user_no', teams, [driver, declined])).toBe(false);
  });

  it('hides people on other teams entirely', () => {
    const other = team({ id: 'team_2', driverUserId: 'user_other_driver' });
    const memberships = [
      driver,
      member({ teamId: 'team_2', userId: 'user_other_driver', role: 'driver' }),
      member({ teamId: 'team_2', userId: 'user_stranger' }),
    ];
    expect(canSeePhone('user_driver', 'user_stranger', [team(), other], memberships)).toBe(false);
  });

  it('lets people who share any one team see each other, even if not all', () => {
    const second = team({ id: 'team_2', driverUserId: 'user_rider' });
    const memberships = [
      driver,
      rider,
      member({ teamId: 'team_2', userId: 'user_rider', role: 'driver' }),
    ];
    expect(canSeePhone('user_driver', 'user_rider', [team(), second], memberships)).toBe(true);
  });

  it('shows nothing to a signed-out stranger', () => {
    expect(canSeePhone('anonymous', 'user_driver', teams, [driver])).toBe(false);
  });
});

// ===========================================================================
describe('what a team member may do', () => {
  const t = team();
  const driver = member({ userId: 'user_driver', role: 'driver' });
  const rider = member({ userId: 'user_rider' });
  const outsider = 'user_outsider';
  const memberships = [driver, rider];

  it('shows the ride log to members and nobody else', () => {
    expect(canSeeTeamRides('user_driver', t, memberships)).toBe(true);
    expect(canSeeTeamRides('user_rider', t, memberships)).toBe(true);
    expect(canSeeTeamRides(outsider, t, memberships)).toBe(false);
  });

  it('lets a passenger log their own ride, which is the point', () => {
    expect(canLogRide('user_rider', t, memberships)).toBe(true);
    expect(canLogRide(outsider, t, memberships)).toBe(false);
  });

  it('reserves admitting, removing and billing for the captain', () => {
    expect(canManageTeam('user_driver', t)).toBe(true);
    expect(canManageTeam('user_rider', t)).toBe(false);
  });

  it('lets a passenger correct only their own entries', () => {
    expect(canEditRide('user_rider', t, 'user_rider')).toBe(true);
    // A passenger must not be able to delete someone else's trips and change
    // what everybody owes.
    expect(canEditRide('user_rider', t, 'user_rider_2')).toBe(false);
    // The driver can correct anything.
    expect(canEditRide('user_driver', t, 'user_rider_2')).toBe(true);
  });

  it('counts members and pending requests separately', () => {
    const withRequest = [...memberships, member({ userId: 'user_new', status: 'requested' })];
    expect(activeMembers(withRequest, 'team_1')).toHaveLength(2);
    expect(pendingRequests(withRequest, 'team_1')).toHaveLength(1);
    expect(isActiveMember(withRequest, 'team_1', 'user_new')).toBe(false);
  });
});

// ===========================================================================
describe('a public listing', () => {
  it('carries no phone number and no passenger names', () => {
    const listing = toPublicListing({
      team: team(),
      route: route(),
      driver: profile(),
      memberships: [member({ userId: 'user_driver', role: 'driver' }), member({ userId: 'user_rider' })],
      viewerId: 'user_stranger',
    });

    const serialised = JSON.stringify(listing);
    expect(serialised).not.toContain('923001234567');
    expect(serialised).not.toContain('user_rider');
    expect(listing.driverName).toBe('Youshay');
  });

  it('reports free seats from the passengers already aboard', () => {
    const listing = toPublicListing({
      team: team(),
      route: route({ seatsTotal: 4 }),
      driver: profile(),
      memberships: [
        member({ userId: 'user_driver', role: 'driver' }),
        member({ userId: 'user_r1' }),
        member({ userId: 'user_r2' }),
      ],
      viewerId: null,
    });
    // Four seats, two passengers aboard (the driver is not a passenger).
    expect(listing.seatsFree).toBe(2);
  });

  it('tells the viewer where they already stand with this team', () => {
    const pending = toPublicListing({
      team: team(),
      route: route(),
      driver: profile(),
      memberships: [member({ userId: 'user_me', status: 'requested' })],
      viewerId: 'user_me',
    });
    expect(pending.viewerStatus).toBe('requested');

    const fresh = toPublicListing({
      team: team(),
      route: route(),
      driver: profile(),
      memberships: [],
      viewerId: 'user_me',
    });
    expect(fresh.viewerStatus).toBe('none');
  });

  it('only lists routes whose team and route are both open', () => {
    const teams = [
      team({ id: 'open' }),
      team({ id: 'private', discoverable: false }),
    ];
    const routes = [
      route({ id: 'r_open', teamId: 'open' }),
      route({ id: 'r_private', teamId: 'private' }),
      route({ id: 'r_hidden', teamId: 'open', discoverable: false }),
      route({ id: 'r_stopped', teamId: 'open', active: false }),
    ];
    expect(listableRoutes(teams, routes).map((r) => r.id)).toEqual(['r_open']);
  });
});

// ===========================================================================
describe('phone numbers', () => {
  it('normalises the ways people actually write them', () => {
    expect(normalisePhone('+92 300 1234567')).toBe('+923001234567');
    expect(normalisePhone('+92-300-1234567')).toBe('+923001234567');
    expect(normalisePhone('0092 300 1234567')).toBe('+923001234567');
    expect(normalisePhone('923001234567')).toBe('+923001234567');
    expect(normalisePhone('(0300) 123 4567')).toBe('+03001234567');
  });

  it('rejects what is not a number', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('   ')).toBeNull();
    expect(normalisePhone('call me')).toBeNull();
    expect(normalisePhone('12345')).toBeNull(); // too short
    expect(normalisePhone('+1234567890123456789')).toBeNull(); // too long
    expect(isValidPhone('+923001234567')).toBe(true);
    expect(isValidPhone('nope')).toBe(false);
  });

  it('builds a WhatsApp link with the message prefilled', () => {
    const link = whatsappLink('+92 300 1234567', 'Salaam, about the carpool');
    expect(link).toBe('https://wa.me/923001234567?text=Salaam%2C%20about%20the%20carpool');
  });

  it('builds no link at all without a number', () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink('not a number')).toBeNull();
  });

  it('masks a number where it must not be shown in full', () => {
    expect(maskPhone('+923001234567')).toBe('+923 ••• 567');
    expect(maskPhone(null)).toBe('—');
  });
});

// ===========================================================================
describe('invite links', () => {
  function invite(over: Partial<CarpoolInvite> = {}): CarpoolInvite {
    return {
      id: 'inv_1',
      teamId: 'team_1',
      token: 'ABCDEFGH',
      createdBy: 'user_driver',
      expiresAt: null,
      maxUses: null,
      uses: 0,
      revoked: false,
      createdAt: NOW,
      ...over,
    };
  }

  it('accepts a good link', () => {
    const check = checkInvite('ABCDEFGH', [invite()], [], 'user_new', NOW);
    expect(check.ok).toBe(true);
  });

  it('rejects an unknown token', () => {
    const check = checkInvite('NOPE', [invite()], [], 'user_new', NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.problem).toBe('unknown');
  });

  it('rejects a revoked link, and says the driver cancelled it', () => {
    const check = checkInvite('ABCDEFGH', [invite({ revoked: true })], [], 'user_new', NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.problem).toBe('revoked');
      expect(check.message).toMatch(/cancelled/i);
    }
  });

  it('rejects an expired link and suggests asking for a new one', () => {
    const check = checkInvite(
      'ABCDEFGH',
      [invite({ expiresAt: '2026-09-01T00:00:00.000Z' })],
      [],
      'user_new',
      NOW,
    );
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.problem).toBe('expired');
      expect(check.message).toMatch(/new one/i);
    }
  });

  it('rejects a single-use link that has been used', () => {
    const check = checkInvite('ABCDEFGH', [invite({ maxUses: 1, uses: 1 })], [], 'user_new', NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.problem).toBe('used_up');
  });

  it('tells an existing member they are already in', () => {
    const check = checkInvite(
      'ABCDEFGH',
      [invite()],
      [member({ userId: 'user_existing', status: 'active' })],
      'user_existing',
      NOW,
    );
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.problem).toBe('already_member');
  });

  it('still validates for someone not signed in, so the link can be previewed', () => {
    expect(checkInvite('ABCDEFGH', [invite()], [], null, NOW).ok).toBe(true);
  });

  it('mints tokens that are long, unguessable and free of confusable characters', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => newInviteToken()));
    expect(tokens.size).toBe(500);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
      expect(t).not.toMatch(/[OI01L]/); // misread when spoken aloud
    }
  });

  it('builds and parses a shareable link', () => {
    const url = inviteUrl('ABCDEFGH', 'https://pocketa.app/');
    expect(url).toBe('https://pocketa.app/#/join/ABCDEFGH');
    expect(parseInviteInput(url)).toBe('ABCDEFGH');
  });

  it('accepts a typed code as readily as a pasted link', () => {
    expect(parseInviteInput('  abcdefgh  ')).toBe('ABCDEFGH');
    expect(parseInviteInput('https://pocketa.app/#/join/ABCDEFGH')).toBe('ABCDEFGH');
    expect(parseInviteInput('nonsense!')).toBeNull();
    expect(parseInviteInput('')).toBeNull();
  });
});
