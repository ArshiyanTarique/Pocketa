/**
 * Geography for route matching.
 *
 * Everything here works in metres on the ground rather than in degrees, because
 * a degree of longitude in Karachi is about 107 km while a degree of latitude is
 * about 111 km — comparing raw coordinate deltas would quietly bias every match
 * along one axis.
 *
 * Distances use the haversine formula. Point-to-line work projects onto a local
 * flat plane first, which is accurate to well under a metre at city scale and
 * avoids trigonometry inside the inner loop of a search.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  /** What a person calls it: "Gulshan", "NED University". */
  name: string;
}

/** Mean Earth radius, metres. */
const EARTH_RADIUS = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function isValidLatLng(p: unknown): p is LatLng {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p as LatLng;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Great-circle distance in metres. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Project a point onto a local flat plane centred on `origin`, in metres.
 *
 * Longitude is scaled by cos(latitude) so that a metre east and a metre north
 * are the same length on the plane — the whole point of doing this rather than
 * comparing degrees.
 */
export function toLocalMetres(origin: LatLng, p: LatLng): { x: number; y: number } {
  const latScale = Math.cos(toRad(origin.lat));
  return {
    x: toRad(p.lng - origin.lng) * EARTH_RADIUS * latScale,
    y: toRad(p.lat - origin.lat) * EARTH_RADIUS,
  };
}

export interface SegmentHit {
  /** Perpendicular distance from the point to the segment, in metres. */
  distance: number;
  /** How far along the segment the closest point lies, 0 to 1. */
  t: number;
  /** The closest point itself. */
  closest: LatLng;
}

/**
 * Distance from a point to a line segment.
 *
 * A route is a chain of segments, so "how far is this address from the route"
 * is this, minimised. Clamping `t` to [0,1] matters: without it, a point far
 * beyond the end of a segment would report a small perpendicular distance to
 * the infinite line it lies on.
 */
export function distanceToSegment(point: LatLng, a: LatLng, b: LatLng): SegmentHit {
  const p = toLocalMetres(a, point);
  const q = toLocalMetres(a, b);

  const lengthSquared = q.x * q.x + q.y * q.y;
  if (lengthSquared === 0) {
    // A zero-length segment is just its own endpoint.
    return { distance: distanceMetres(point, a), t: 0, closest: a };
  }

  const raw = (p.x * q.x + p.y * q.y) / lengthSquared;
  const t = Math.max(0, Math.min(1, raw));

  const closest: LatLng = {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
  return { distance: distanceMetres(point, closest), t, closest };
}

export interface PathHit {
  /** Distance from the point to the nearest place on the path, in metres. */
  distance: number;
  /** Index of the segment the nearest place lies on. */
  segmentIndex: number;
  /** Distance travelled along the path to reach it, in metres. */
  along: number;
  closest: LatLng;
}

export function pathLengthMetres(path: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distanceMetres(path[i - 1], path[i]);
  return total;
}

/**
 * The nearest point on a whole path, and how far along the path it sits.
 *
 * `along` is what makes direction checkable: a pickup must come before a
 * drop-off, or the driver would be going the wrong way for that passenger.
 */
export function nearestOnPath(point: LatLng, path: readonly LatLng[]): PathHit {
  if (path.length === 0) {
    return { distance: Infinity, segmentIndex: -1, along: 0, closest: point };
  }
  if (path.length === 1) {
    return { distance: distanceMetres(point, path[0]), segmentIndex: 0, along: 0, closest: path[0] };
  }

  let best: PathHit = { distance: Infinity, segmentIndex: 0, along: 0, closest: path[0] };
  let travelled = 0;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segmentLength = distanceMetres(a, b);
    const hit = distanceToSegment(point, a, b);

    if (hit.distance < best.distance) {
      best = {
        distance: hit.distance,
        segmentIndex: i - 1,
        along: travelled + segmentLength * hit.t,
        closest: hit.closest,
      };
    }
    travelled += segmentLength;
  }
  return best;
}

/** A rough bounding box around a path, padded by `padMetres`. */
export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function boundsOf(path: readonly LatLng[], padMetres = 0): Bounds | null {
  if (path.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of path) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  if (padMetres > 0) {
    const latPad = (padMetres / EARTH_RADIUS) * (180 / Math.PI);
    const midLat = (minLat + maxLat) / 2;
    const lngPad = latPad / Math.max(0.01, Math.cos(toRad(midLat)));
    minLat -= latPad;
    maxLat += latPad;
    minLng -= lngPad;
    maxLng += lngPad;
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function withinBounds(p: LatLng, bounds: Bounds): boolean {
  return (
    p.lat >= bounds.minLat && p.lat <= bounds.maxLat && p.lng >= bounds.minLng && p.lng <= bounds.maxLng
  );
}

/** "1.2 km" / "450 m", for the distances a person actually reads. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return '—';
  if (metres < 950) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(metres < 9500 ? 1 : 0)} km`;
}

/** Roughly how long a walk takes, at a real pace rather than an optimistic one. */
export function walkingMinutes(metres: number): number {
  const METRES_PER_MINUTE = 75; // ~4.5 km/h, allowing for crossings
  return Math.max(1, Math.round(metres / METRES_PER_MINUTE));
}
