import { describe, it, expect } from 'vitest';
import {
  distanceMetres,
  distanceToSegment,
  nearestOnPath,
  pathLengthMetres,
  boundsOf,
  withinBounds,
  toLocalMetres,
  isValidLatLng,
  formatDistance,
  walkingMinutes,
  type LatLng,
} from './geo';

// Real places, so a wrong answer looks wrong rather than merely differing.
const GULSHAN: LatLng = { lat: 24.9204, lng: 67.0942 };
const NED: LatLng = { lat: 24.9333, lng: 67.1103 };
const KARACHI_UNI: LatLng = { lat: 24.9425, lng: 67.1183 };
const SADDAR: LatLng = { lat: 24.8607, lng: 67.0104 };
const CLIFTON: LatLng = { lat: 24.8138, lng: 67.03 };

describe('distance', () => {
  it('measures a known city hop', () => {
    // Gulshan-e-Iqbal to NED University is a little over 2 km.
    const d = distanceMetres(GULSHAN, NED);
    expect(d).toBeGreaterThan(1900);
    expect(d).toBeLessThan(2400);
  });

  it('measures a longer cross-city run', () => {
    // Gulshan to Saddar is roughly 10-11 km.
    const d = distanceMetres(GULSHAN, SADDAR);
    expect(d).toBeGreaterThan(9000);
    expect(d).toBeLessThan(12000);
  });

  it('is zero for the same point and symmetric between two', () => {
    expect(distanceMetres(GULSHAN, GULSHAN)).toBe(0);
    expect(distanceMetres(GULSHAN, NED)).toBeCloseTo(distanceMetres(NED, GULSHAN), 6);
  });

  it('handles a degree of latitude at about 111 km', () => {
    const d = distanceMetres({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('scales longitude by latitude, rather than treating degrees as equal', () => {
    // A degree of longitude shrinks toward the poles; at Karachi's latitude it
    // is about 91% of a degree at the equator.
    const atEquator = distanceMetres({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const atKarachi = distanceMetres({ lat: 24.9, lng: 0 }, { lat: 24.9, lng: 1 });
    expect(atKarachi / atEquator).toBeCloseTo(Math.cos((24.9 * Math.PI) / 180), 2);
  });

  it('crosses the antimeridian without exploding', () => {
    const d = distanceMetres({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    expect(d).toBeLessThan(30_000);
  });
});

describe('local projection', () => {
  it('puts north as positive y and east as positive x', () => {
    const north = toLocalMetres(GULSHAN, { lat: GULSHAN.lat + 0.01, lng: GULSHAN.lng });
    const east = toLocalMetres(GULSHAN, { lat: GULSHAN.lat, lng: GULSHAN.lng + 0.01 });
    expect(north.y).toBeGreaterThan(0);
    expect(Math.abs(north.x)).toBeLessThan(1);
    expect(east.x).toBeGreaterThan(0);
    expect(Math.abs(east.y)).toBeLessThan(1);
  });

  it('agrees with the great-circle distance at city scale', () => {
    const p = toLocalMetres(GULSHAN, NED);
    const planar = Math.hypot(p.x, p.y);
    expect(planar).toBeCloseTo(distanceMetres(GULSHAN, NED), -1); // within ~10 m
  });
});

describe('distance to a segment', () => {
  const a: LatLng = { lat: 24.90, lng: 67.00 };
  const b: LatLng = { lat: 24.90, lng: 67.10 };

  it('finds the perpendicular drop onto the middle of a segment', () => {
    const point: LatLng = { lat: 24.91, lng: 67.05 };
    const hit = distanceToSegment(point, a, b);
    expect(hit.t).toBeGreaterThan(0.4);
    expect(hit.t).toBeLessThan(0.6);
    // 0.01 degrees of latitude is about 1.1 km.
    expect(hit.distance).toBeGreaterThan(1000);
    expect(hit.distance).toBeLessThan(1200);
  });

  it('clamps beyond the ends instead of measuring to an infinite line', () => {
    // Far past b along the same bearing: the answer must be the distance to b,
    // not a small perpendicular distance to the line through a and b.
    const beyond: LatLng = { lat: 24.90, lng: 67.30 };
    const hit = distanceToSegment(beyond, a, b);
    expect(hit.t).toBe(1);
    expect(hit.distance).toBeCloseTo(distanceMetres(beyond, b), 0);
  });

  it('clamps before the start too', () => {
    const before: LatLng = { lat: 24.90, lng: 66.80 };
    const hit = distanceToSegment(before, a, b);
    expect(hit.t).toBe(0);
    expect(hit.distance).toBeCloseTo(distanceMetres(before, a), 0);
  });

  it('treats a zero-length segment as a point', () => {
    const hit = distanceToSegment(NED, GULSHAN, GULSHAN);
    expect(hit.distance).toBeCloseTo(distanceMetres(NED, GULSHAN), 6);
    expect(hit.t).toBe(0);
  });

  it('reports zero for a point already on the segment', () => {
    const midpoint: LatLng = { lat: 24.90, lng: 67.05 };
    expect(distanceToSegment(midpoint, a, b).distance).toBeLessThan(1);
  });
});

describe('nearest point on a path', () => {
  const route = [SADDAR, GULSHAN, NED, KARACHI_UNI];

  it('measures how far along the path the nearest point lies', () => {
    const nearNed = nearestOnPath({ lat: 24.9340, lng: 67.1110 }, route);
    const nearSaddar = nearestOnPath({ lat: 24.8610, lng: 67.0110 }, route);
    expect(nearNed.along).toBeGreaterThan(nearSaddar.along);
    expect(nearSaddar.along).toBeLessThan(500);
  });

  it('identifies which segment the nearest point falls on', () => {
    const hit = nearestOnPath(NED, route);
    expect(hit.segmentIndex).toBe(1); // the Gulshan → NED leg ends here
    expect(hit.distance).toBeLessThan(50);
  });

  it('totals the path length across every leg', () => {
    const expected =
      distanceMetres(SADDAR, GULSHAN) +
      distanceMetres(GULSHAN, NED) +
      distanceMetres(NED, KARACHI_UNI);
    expect(pathLengthMetres(route)).toBeCloseTo(expected, 6);
  });

  it('handles a single-point and an empty path', () => {
    expect(nearestOnPath(NED, [GULSHAN]).distance).toBeCloseTo(distanceMetres(NED, GULSHAN), 6);
    expect(nearestOnPath(NED, []).distance).toBe(Infinity);
    expect(pathLengthMetres([])).toBe(0);
  });
});

describe('bounds', () => {
  it('encloses every point on the path', () => {
    const box = boundsOf([SADDAR, GULSHAN, KARACHI_UNI])!;
    for (const p of [SADDAR, GULSHAN, KARACHI_UNI]) expect(withinBounds(p, box)).toBe(true);
  });

  it('excludes a point well outside', () => {
    const box = boundsOf([GULSHAN, NED])!;
    expect(withinBounds(CLIFTON, box)).toBe(false);
  });

  it('padding admits a point just outside the raw box', () => {
    const tight = boundsOf([GULSHAN, NED])!;
    const nearby: LatLng = { lat: GULSHAN.lat - 0.005, lng: GULSHAN.lng }; // ~550 m south
    expect(withinBounds(nearby, tight)).toBe(false);
    expect(withinBounds(nearby, boundsOf([GULSHAN, NED], 1000)!)).toBe(true);
  });

  it('returns nothing for an empty path', () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe('validation', () => {
  it('accepts real coordinates and rejects impossible ones', () => {
    expect(isValidLatLng(GULSHAN)).toBe(true);
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: 181 })).toBe(false);
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: '24.9', lng: 67 })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
    expect(isValidLatLng(undefined)).toBe(false);
  });
});

describe('presentation', () => {
  it('formats distances the way a person reads them', () => {
    expect(formatDistance(120)).toBe('120 m');
    expect(formatDistance(940)).toBe('940 m');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(12_000)).toBe('12 km');
    expect(formatDistance(Number.NaN)).toBe('—');
  });

  it('estimates a walk at a realistic pace, never zero minutes', () => {
    expect(walkingMinutes(0)).toBe(1);
    expect(walkingMinutes(750)).toBe(10);
    expect(walkingMinutes(1500)).toBe(20);
  });
});
