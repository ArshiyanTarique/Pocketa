/**
 * Finding a ride on someone's route.
 *
 * The question a passenger is really asking is not "is this driver near me" but
 * "does this driver pass my start, and then my end, on a day and at a time that
 * works". Three things fall out of that:
 *
 *   - Both ends must be near the route, not just the start. A driver who passes
 *     your house but ends up across the city is no use.
 *   - The pickup must come BEFORE the drop-off along the path. Without that
 *     check, every route matches its own reverse, and passengers get offered
 *     rides going the wrong way.
 *   - A match is ranked by how far the passenger has to walk, because that is
 *     what they actually feel.
 */

import {
  boundsOf,
  distanceMetres,
  formatDistance,
  nearestOnPath,
  pathLengthMetres,
  walkingMinutes,
  withinBounds,
  type LatLng,
  type Place,
} from './geo';
import type { ID } from './types';

export interface CarpoolRoute {
  id: ID;
  teamId: ID;
  name: string;
  /** Origin, any waypoints, then destination. At least two points. */
  path: Place[];
  /** Days it runs. 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Local departure time, 'HH:mm'. */
  departure: string;
  /** How far off the route the driver will go to collect someone. */
  pickupRadiusMetres: number;
  seatsTotal: number;
  seatsTaken: number;
  /** Listed in public search, as opposed to team-only. */
  discoverable: boolean;
  active: boolean;
}

export interface RideRequest {
  origin: LatLng;
  destination: LatLng;
  /** Restrict to routes running this weekday. */
  day?: number;
  /** Restrict to routes departing near this 'HH:mm'. */
  time?: string;
  /** How far the passenger is willing to walk to a pickup point. */
  maxWalkMetres?: number;
  /** How far from their stated time they will accept, in minutes. */
  timeToleranceMinutes?: number;
}

export interface MatchEnd {
  /** The point on the route nearest the passenger's own point. */
  place: LatLng;
  walkMetres: number;
  walkMinutes: number;
  /** Distance along the route, in metres. */
  along: number;
}

export interface RouteMatch {
  route: CarpoolRoute;
  pickup: MatchEnd;
  dropoff: MatchEnd;
  totalWalkMetres: number;
  /** Distance actually ridden on the route. */
  rideMetres: number;
  /** The passenger's own straight-line journey, for comparison. */
  directMetres: number;
  /** Free seats at the time of the search. */
  seatsFree: number;
  /**
   * Lower is better. Dominated by walking, since that is the part a passenger
   * experiences as cost, with a nudge against wildly indirect rides.
   */
  score: number;
}

export const DEFAULT_MAX_WALK_METRES = 1200;
export const DEFAULT_TIME_TOLERANCE_MINUTES = 45;

export function minutesOfDay(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes between two times of day, taking the shorter way around midnight. */
export function timeGapMinutes(a: string, b: string): number | null {
  const ma = minutesOfDay(a);
  const mb = minutesOfDay(b);
  if (ma == null || mb == null) return null;
  const raw = Math.abs(ma - mb);
  return Math.min(raw, 1440 - raw);
}

export type MatchFailure =
  | 'inactive'
  | 'wrong_day'
  | 'wrong_time'
  | 'origin_too_far'
  | 'destination_too_far'
  | 'wrong_direction'
  | 'no_seats'
  | 'bad_route';

export type MatchOutcome =
  | { matched: true; match: RouteMatch }
  | { matched: false; reason: MatchFailure };

/**
 * Test one route against one request.
 *
 * Returns a reason rather than a bare false, so the UI can say "that driver
 * goes the other way" instead of showing an empty list with no explanation.
 */
export function matchRoute(route: CarpoolRoute, request: RideRequest): MatchOutcome {
  if (route.path.length < 2) return { matched: false, reason: 'bad_route' };
  if (!route.active) return { matched: false, reason: 'inactive' };

  if (request.day != null && route.days.length > 0 && !route.days.includes(request.day)) {
    return { matched: false, reason: 'wrong_day' };
  }

  if (request.time) {
    const tolerance = request.timeToleranceMinutes ?? DEFAULT_TIME_TOLERANCE_MINUTES;
    const gap = timeGapMinutes(route.departure, request.time);
    if (gap == null || gap > tolerance) return { matched: false, reason: 'wrong_time' };
  }

  const maxWalk = request.maxWalkMetres ?? DEFAULT_MAX_WALK_METRES;
  // The driver's willingness to divert and the passenger's willingness to walk
  // are different limits; the tighter one wins.
  const reach = Math.min(maxWalk, route.pickupRadiusMetres);

  const pickupHit = nearestOnPath(request.origin, route.path);
  if (pickupHit.distance > reach) return { matched: false, reason: 'origin_too_far' };

  const dropoffHit = nearestOnPath(request.destination, route.path);
  if (dropoffHit.distance > reach) return { matched: false, reason: 'destination_too_far' };

  // The whole point: the ride must run start-to-end, not end-to-start.
  if (dropoffHit.along <= pickupHit.along) {
    return { matched: false, reason: 'wrong_direction' };
  }

  const seatsFree = Math.max(0, route.seatsTotal - route.seatsTaken);
  if (seatsFree === 0) return { matched: false, reason: 'no_seats' };

  const totalWalk = pickupHit.distance + dropoffHit.distance;
  const rideMetres = dropoffHit.along - pickupHit.along;
  const directMetres = distanceMetres(request.origin, request.destination);

  // Walking dominates; a ride much longer than the direct line is penalised
  // lightly, since some detour is the nature of sharing a car.
  const indirectness = directMetres > 0 ? Math.max(0, rideMetres / directMetres - 1) : 0;
  const score = totalWalk + indirectness * 500;

  return {
    matched: true,
    match: {
      route,
      pickup: {
        place: pickupHit.closest,
        walkMetres: Math.round(pickupHit.distance),
        walkMinutes: walkingMinutes(pickupHit.distance),
        along: pickupHit.along,
      },
      dropoff: {
        place: dropoffHit.closest,
        walkMetres: Math.round(dropoffHit.distance),
        walkMinutes: walkingMinutes(dropoffHit.distance),
        along: dropoffHit.along,
      },
      totalWalkMetres: Math.round(totalWalk),
      rideMetres: Math.round(rideMetres),
      directMetres: Math.round(directMetres),
      seatsFree,
      score,
    },
  };
}

export interface SearchResult {
  matches: RouteMatch[];
  /** Why the rest were rejected, so the UI can explain an empty result. */
  rejected: Record<MatchFailure, number>;
  considered: number;
}

const EMPTY_REJECTIONS = (): Record<MatchFailure, number> => ({
  inactive: 0,
  wrong_day: 0,
  wrong_time: 0,
  origin_too_far: 0,
  destination_too_far: 0,
  wrong_direction: 0,
  no_seats: 0,
  bad_route: 0,
});

/**
 * Rank every route against a request.
 *
 * A cheap bounding-box test runs first so that a search over many routes does
 * not do path geometry for drivers on the other side of the city.
 */
export function searchRoutes(
  routes: readonly CarpoolRoute[],
  request: RideRequest,
  limit = 20,
): SearchResult {
  const rejected = EMPTY_REJECTIONS();
  const matches: RouteMatch[] = [];
  const reach = Math.min(
    request.maxWalkMetres ?? DEFAULT_MAX_WALK_METRES,
    // The widest any route might reach; refined per-route inside matchRoute.
    Math.max(...routes.map((r) => r.pickupRadiusMetres), DEFAULT_MAX_WALK_METRES),
  );

  let considered = 0;
  for (const route of routes) {
    const box = boundsOf(route.path, reach);
    if (box && !withinBounds(request.origin, box) && !withinBounds(request.destination, box)) {
      rejected.origin_too_far++;
      continue;
    }
    considered++;

    const outcome = matchRoute(route, request);
    if (outcome.matched) matches.push(outcome.match);
    else rejected[outcome.reason]++;
  }

  matches.sort((a, b) => a.score - b.score || a.route.name.localeCompare(b.route.name));
  return { matches: matches.slice(0, limit), rejected, considered };
}

/** Why a search found nothing, in words rather than counts. */
export function explainEmptySearch(result: SearchResult): string {
  const { rejected } = result;
  if (rejected.wrong_direction > 0 && rejected.wrong_direction >= rejected.origin_too_far) {
    return 'Some drivers pass both your stops, but travel the other way. Try swapping your start and destination.';
  }
  if (rejected.wrong_time > 0 && rejected.wrong_time >= rejected.wrong_day) {
    return 'There are routes along your way, but none leaving near that time. Widen the time or try another.';
  }
  if (rejected.wrong_day > 0) {
    return 'Nobody runs this route on that day yet.';
  }
  if (rejected.no_seats > 0) {
    return 'The routes along your way are full at the moment.';
  }
  if (rejected.destination_too_far > 0 && rejected.origin_too_far === 0) {
    return 'Drivers pass your starting point, but none go near your destination.';
  }
  return 'No routes go your way yet. Try a wider walking distance, or ask a driver you know to list their route.';
}

/** A short human summary of a route, for a list row. */
export function describeRoute(route: CarpoolRoute): string {
  const from = route.path[0]?.name ?? 'Start';
  const to = route.path[route.path.length - 1]?.name ?? 'End';
  return `${from} → ${to}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeDays(days: readonly number[]): string {
  if (days.length === 0) return 'Any day';
  if (days.length === 7) return 'Every day';

  const sorted = [...days].sort((a, b) => a - b);
  const weekdays = [1, 2, 3, 4, 5];
  if (sorted.length === 5 && weekdays.every((d) => sorted.includes(d))) return 'Weekdays';

  return sorted.map((d) => DAY_NAMES[d] ?? '?').join(', ');
}

export function routeLengthMetres(route: CarpoolRoute): number {
  return pathLengthMetres(route.path);
}

export { formatDistance };
