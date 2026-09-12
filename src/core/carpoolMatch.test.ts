import { describe, it, expect } from 'vitest';
import {
  matchRoute,
  searchRoutes,
  explainEmptySearch,
  describeDays,
  describeRoute,
  timeGapMinutes,
  minutesOfDay,
  routeLengthMetres,
  type CarpoolRoute,
  type RideRequest,
} from './carpoolMatch';
import type { Place } from './geo';

// A real corridor across Karachi: Saddar out to the university area.
const SADDAR: Place = { lat: 24.8607, lng: 67.0104, name: 'Saddar' };
const NAZIMABAD: Place = { lat: 24.9089, lng: 67.0353, name: 'Nazimabad' };
const GULSHAN: Place = { lat: 24.9204, lng: 67.0942, name: 'Gulshan-e-Iqbal' };
const NED: Place = { lat: 24.9333, lng: 67.1103, name: 'NED University' };
const CLIFTON: Place = { lat: 24.8138, lng: 67.03, name: 'Clifton' };
const MALIR: Place = { lat: 24.8925, lng: 67.205, name: 'Malir' };

function route(over: Partial<CarpoolRoute> = {}): CarpoolRoute {
  return {
    id: 'route_1',
    teamId: 'team_1',
    name: 'Morning run to NED',
    path: [SADDAR, NAZIMABAD, GULSHAN, NED],
    days: [1, 2, 3, 4, 5],
    departure: '07:30',
    pickupRadiusMetres: 1500,
    seatsTotal: 4,
    seatsTaken: 1,
    discoverable: true,
    active: true,
    ...over,
  };
}

describe('matching a passenger to a route', () => {
  it('matches someone travelling the same way along the corridor', () => {
    const request: RideRequest = {
      origin: { lat: 24.9095, lng: 67.036 }, // beside Nazimabad
      destination: { lat: 24.9330, lng: 67.110 }, // beside NED
    };
    const outcome = matchRoute(route(), request);
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;

    expect(outcome.match.pickup.walkMetres).toBeLessThan(200);
    expect(outcome.match.dropoff.walkMetres).toBeLessThan(200);
    expect(outcome.match.dropoff.along).toBeGreaterThan(outcome.match.pickup.along);
    expect(outcome.match.seatsFree).toBe(3);
  });

  it('refuses a passenger going the other way down the same road', () => {
    // The single most important check: this route runs Saddar → NED, so
    // someone travelling NED → Saddar must not be offered it.
    const outcome = matchRoute(route(), {
      origin: { lat: 24.9330, lng: 67.110 }, // NED
      destination: { lat: 24.9095, lng: 67.036 }, // Nazimabad
    });
    expect(outcome.matched).toBe(false);
    if (outcome.matched) return;
    expect(outcome.reason).toBe('wrong_direction');
  });

  it('refuses someone whose start is nowhere near the route', () => {
    const outcome = matchRoute(route(), {
      origin: CLIFTON,
      destination: NED,
    });
    expect(outcome.matched).toBe(false);
    if (!outcome.matched) expect(outcome.reason).toBe('origin_too_far');
  });

  it('refuses someone whose destination is off the route, even if the start is on it', () => {
    // A driver who passes your house is no use if they end up elsewhere.
    const outcome = matchRoute(route(), {
      origin: { lat: 24.9095, lng: 67.036 },
      destination: MALIR,
    });
    expect(outcome.matched).toBe(false);
    if (!outcome.matched) expect(outcome.reason).toBe('destination_too_far');
  });

  it('honours the passenger walking limit as well as the driver detour limit', () => {
    // ~900 m off the corridor.
    const request: RideRequest = {
      origin: { lat: 24.9165, lng: 67.036 },
      destination: NED,
    };
    expect(matchRoute(route({ pickupRadiusMetres: 2000 }), { ...request, maxWalkMetres: 2000 }).matched).toBe(true);
    // The passenger will only walk 300 m, so it is no longer a match.
    const strict = matchRoute(route({ pickupRadiusMetres: 2000 }), { ...request, maxWalkMetres: 300 });
    expect(strict.matched).toBe(false);
    if (!strict.matched) expect(strict.reason).toBe('origin_too_far');
  });

  it('respects the days a route runs', () => {
    const weekdayOnly = route({ days: [1, 2, 3, 4, 5] });
    const base = { origin: { lat: 24.9095, lng: 67.036 }, destination: NED };
    expect(matchRoute(weekdayOnly, { ...base, day: 3 }).matched).toBe(true);

    const sunday = matchRoute(weekdayOnly, { ...base, day: 0 });
    expect(sunday.matched).toBe(false);
    if (!sunday.matched) expect(sunday.reason).toBe('wrong_day');
  });

  it('respects departure time within a tolerance', () => {
    const base = { origin: { lat: 24.9095, lng: 67.036 }, destination: NED };
    expect(matchRoute(route(), { ...base, time: '07:45' }).matched).toBe(true);

    const tooLate = matchRoute(route(), { ...base, time: '14:00' });
    expect(tooLate.matched).toBe(false);
    if (!tooLate.matched) expect(tooLate.reason).toBe('wrong_time');

    // A generous tolerance lets it through again.
    expect(matchRoute(route(), { ...base, time: '09:00', timeToleranceMinutes: 120 }).matched).toBe(true);
  });

  it('refuses a full car', () => {
    const outcome = matchRoute(route({ seatsTotal: 3, seatsTaken: 3 }), {
      origin: { lat: 24.9095, lng: 67.036 },
      destination: NED,
    });
    expect(outcome.matched).toBe(false);
    if (!outcome.matched) expect(outcome.reason).toBe('no_seats');
  });

  it('refuses an inactive route and a malformed one', () => {
    const base = { origin: { lat: 24.9095, lng: 67.036 }, destination: NED };
    const inactive = matchRoute(route({ active: false }), base);
    expect(inactive.matched).toBe(false);
    if (!inactive.matched) expect(inactive.reason).toBe('inactive');

    const broken = matchRoute(route({ path: [GULSHAN] }), base);
    expect(broken.matched).toBe(false);
    if (!broken.matched) expect(broken.reason).toBe('bad_route');
  });

  it('reports the ride length against the passenger direct distance', () => {
    const outcome = matchRoute(route(), {
      origin: { lat: 24.9095, lng: 67.036 },
      destination: { lat: 24.9330, lng: 67.110 },
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    // Following a road is never shorter than the straight line.
    expect(outcome.match.rideMetres).toBeGreaterThanOrEqual(outcome.match.directMetres - 50);
  });
});

describe('searching many routes', () => {
  const direct = route({
    id: 'direct',
    name: 'Straight up the corridor',
    path: [NAZIMABAD, GULSHAN, NED],
  });
  const detour = route({
    id: 'detour',
    name: 'The long way round',
    path: [NAZIMABAD, SADDAR, CLIFTON, GULSHAN, NED],
  });
  const backwards = route({ id: 'backwards', name: 'Homeward', path: [NED, GULSHAN, NAZIMABAD] });
  const elsewhere = route({ id: 'elsewhere', name: 'Across town', path: [CLIFTON, MALIR] });

  const request: RideRequest = {
    origin: { lat: 24.9095, lng: 67.036 },
    destination: { lat: 24.9330, lng: 67.110 },
  };

  it('returns only the routes that genuinely work', () => {
    const result = searchRoutes([direct, detour, backwards, elsewhere], request);
    const ids = result.matches.map((m) => m.route.id);
    expect(ids).toContain('direct');
    expect(ids).not.toContain('backwards');
    expect(ids).not.toContain('elsewhere');
  });

  it('ranks the shortest walk first', () => {
    const near = route({ id: 'near', path: [NAZIMABAD, GULSHAN, NED] });
    // Same corridor but shifted, so the walk at each end is longer.
    const far = route({
      id: 'far',
      path: [
        { ...NAZIMABAD, lat: NAZIMABAD.lat + 0.008 },
        { ...GULSHAN, lat: GULSHAN.lat + 0.008 },
        { ...NED, lat: NED.lat + 0.008 },
      ],
    });
    const result = searchRoutes([far, near], request);
    expect(result.matches[0].route.id).toBe('near');
    expect(result.matches[0].totalWalkMetres).toBeLessThan(result.matches[1].totalWalkMetres);
  });

  it('prefers a direct ride over a long detour, all else equal', () => {
    const result = searchRoutes([detour, direct], request);
    expect(result.matches[0].route.id).toBe('direct');
  });

  it('caps how many it returns', () => {
    const many = Array.from({ length: 40 }, (_, i) => route({ id: `r${i}`, path: [NAZIMABAD, GULSHAN, NED] }));
    expect(searchRoutes(many, request, 5).matches).toHaveLength(5);
  });

  it('counts why the rest were rejected', () => {
    const result = searchRoutes([direct, backwards, elsewhere], request);
    expect(result.rejected.wrong_direction).toBe(1);
    expect(result.matches).toHaveLength(1);
  });

  it('handles having no routes at all', () => {
    const result = searchRoutes([], request);
    expect(result.matches).toEqual([]);
    expect(result.considered).toBe(0);
  });
});

describe('explaining an empty search', () => {
  const request: RideRequest = {
    origin: { lat: 24.9095, lng: 67.036 },
    destination: { lat: 24.9330, lng: 67.110 },
  };

  it('points out when drivers go the other way', () => {
    const result = searchRoutes([route({ path: [NED, GULSHAN, NAZIMABAD] })], request);
    expect(explainEmptySearch(result)).toMatch(/other way|swapping/i);
  });

  it('points out a time mismatch', () => {
    const result = searchRoutes([route()], { ...request, time: '22:00' });
    expect(explainEmptySearch(result)).toMatch(/time/i);
  });

  it('points out a day mismatch', () => {
    const result = searchRoutes([route({ days: [1, 2, 3, 4, 5] })], { ...request, day: 0 });
    expect(explainEmptySearch(result)).toMatch(/day/i);
  });

  it('points out a full car', () => {
    const result = searchRoutes([route({ seatsTotal: 2, seatsTaken: 2 })], request);
    expect(explainEmptySearch(result)).toMatch(/full/i);
  });

  it('falls back to something actionable when nothing is nearby', () => {
    const result = searchRoutes([route({ path: [CLIFTON, MALIR] })], request);
    expect(explainEmptySearch(result)).toMatch(/no routes go your way/i);
  });
});

describe('times', () => {
  it('reads a time of day, and rejects a nonsense one', () => {
    expect(minutesOfDay('07:30')).toBe(450);
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('23:59')).toBe(1439);
    expect(minutesOfDay('24:00')).toBeNull();
    expect(minutesOfDay('7:5')).toBeNull();
    expect(minutesOfDay('morning')).toBeNull();
  });

  it('measures the gap the short way around midnight', () => {
    expect(timeGapMinutes('07:30', '08:00')).toBe(30);
    expect(timeGapMinutes('23:50', '00:10')).toBe(20);
    expect(timeGapMinutes('07:30', '07:30')).toBe(0);
  });
});

describe('describing a route', () => {
  it('names it by its ends', () => {
    expect(describeRoute(route())).toBe('Saddar → NED University');
  });

  it('summarises the days it runs', () => {
    expect(describeDays([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(describeDays([])).toBe('Any day');
    expect(describeDays([1, 3])).toBe('Mon, Wed');
  });

  it('measures the whole corridor', () => {
    // Saddar out to NED is a genuine cross-city run.
    expect(routeLengthMetres(route())).toBeGreaterThan(10_000);
  });
});
