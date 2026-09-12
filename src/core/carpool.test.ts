import { describe, it, expect } from 'vitest';
import {
  rateForRider,
  rateOnTrip,
  tallyRiders,
  summarisePeriod,
  settlementLines,
  tripsToSettle,
  findLoggingGaps,
  lastRiders,
  lifetimeValue,
  unbilledTrips,
} from './carpool';
import { monthRange } from './dates';
import { rs } from '../test/fixtures';
import type { Carpool, CarpoolRider, CarpoolTrip, Person } from './types';

const carpool: Carpool = {
  id: 'cp_1',
  name: 'University run',
  ratePerTrip: rs(150),
  currency: 'PKR',
  settleAs: 'recovery',
  settleCategoryId: 'cat_fuel',
  notes: null,
  archived: false,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

const person = (id: string, name: string): Person => ({
  id, name, contact: null, notes: null, color: null, archived: false,
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
});

const rider = (id: string, personId: string, rate: number | null = null): CarpoolRider => ({
  id, carpoolId: 'cp_1', personId, ratePerTrip: rate, active: true,
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
});

const trip = (
  id: string,
  date: string,
  riderIds: string[],
  rates: Record<string, number> = {},
  settlementId: string | null = null,
): CarpoolTrip => ({
  id, carpoolId: 'cp_1', date, riderIds,
  rates: Object.keys(rates).length ? rates : Object.fromEntries(riderIds.map((r) => [r, rs(150)])),
  note: null, settlementId,
  createdAt: `${date}T08:00:00Z`, updatedAt: `${date}T08:00:00Z`,
});

const people = [person('per_sara', 'Sara'), person('per_bilal', 'Bilal'), person('per_ali', 'Ali')];
const riders = [rider('rd_sara', 'per_sara'), rider('rd_bilal', 'per_bilal'), rider('rd_ali', 'per_ali', rs(200))];

describe('rates', () => {
  it('uses the carpool rate unless a rider has their own', () => {
    expect(rateForRider(riders[0], carpool)).toBe(rs(150));
    expect(rateForRider(riders[2], carpool)).toBe(rs(200)); // Ali lives further out
  });

  it('freezes the rate onto the trip so a later rise does not re-price history', () => {
    const septemberTrip = trip('tp_1', '2026-09-10', ['rd_sara'], { rd_sara: rs(150) });
    // The carpool rate goes up in October.
    const raised: Carpool = { ...carpool, ratePerTrip: rs(220) };

    const tallies = tallyRiders({
      carpool: raised,
      riders: [riders[0]],
      trips: [septemberTrip],
      people,
      range: monthRange('2026-09-15'),
    });

    // September still bills at the old rate.
    expect(tallies[0].amount).toBe(rs(150));
    expect(rateOnTrip(septemberTrip, 'rd_sara', rs(220))).toBe(rs(150));
  });

  it('falls back to the live rate when a trip has none recorded', () => {
    const legacy = { ...trip('tp_x', '2026-09-01', ['rd_sara']), rates: {} };
    expect(rateOnTrip(legacy, 'rd_sara', rs(150))).toBe(rs(150));
  });
});

describe('tallying a month', () => {
  const trips = [
    trip('tp_1', '2026-09-01', ['rd_sara', 'rd_bilal']),
    trip('tp_2', '2026-09-02', ['rd_sara']),
    trip('tp_3', '2026-09-03', ['rd_sara', 'rd_bilal', 'rd_ali'], { rd_sara: rs(150), rd_bilal: rs(150), rd_ali: rs(200) }),
    trip('tp_4', '2026-09-04', ['rd_bilal']),
    trip('tp_5', '2026-08-28', ['rd_sara']), // previous month
  ];

  it('counts only the trips each person was actually on', () => {
    const tallies = tallyRiders({ carpool, riders, trips, people, range: monthRange('2026-09-15') });
    const byName = Object.fromEntries(tallies.map((t) => [t.name, t]));

    expect(byName.Sara.trips).toBe(3);
    expect(byName.Bilal.trips).toBe(3);
    expect(byName.Ali.trips).toBe(1);
  });

  it('multiplies trips by each rider own rate', () => {
    const tallies = tallyRiders({ carpool, riders, trips, people, range: monthRange('2026-09-15') });
    const byName = Object.fromEntries(tallies.map((t) => [t.name, t]));

    expect(byName.Sara.amount).toBe(rs(450)); // 3 x 150
    expect(byName.Bilal.amount).toBe(rs(450)); // 3 x 150
    expect(byName.Ali.amount).toBe(rs(200)); // 1 x 200
  });

  it('excludes trips outside the period', () => {
    const august = tallyRiders({ carpool, riders, trips, people, range: monthRange('2026-08-15') });
    expect(august.find((t) => t.name === 'Sara')!.trips).toBe(1);
  });

  it('summarises the period', () => {
    const summary = summarisePeriod({ carpool, riders, trips, people, range: monthRange('2026-09-15') });
    expect(summary.tripCount).toBe(4);
    expect(summary.unbilledTripCount).toBe(4);
    expect(summary.outstanding).toBe(rs(1100)); // 450 + 450 + 200
    expect(summary.billed).toBe(0);
  });

  it('records who last rode, for the list', () => {
    const tallies = tallyRiders({ carpool, riders, trips, people, range: monthRange('2026-09-15') });
    expect(tallies.find((t) => t.name === 'Bilal')!.lastRode).toBe('2026-09-04');
  });
});

describe('billing never charges twice', () => {
  const trips = [
    trip('tp_1', '2026-09-01', ['rd_sara'], {}, 'st_1'), // already billed
    trip('tp_2', '2026-09-02', ['rd_sara']),
    trip('tp_3', '2026-09-03', ['rd_sara']),
  ];

  it('separates billed from unbilled', () => {
    const tallies = tallyRiders({ carpool, riders: [riders[0]], trips, people, range: monthRange('2026-09-15') });
    const sara = tallies[0];

    expect(sara.trips).toBe(3);
    expect(sara.unbilledTrips).toBe(2);
    expect(sara.amount).toBe(rs(300)); // only the unbilled ones
    expect(sara.billedAmount).toBe(rs(150));
  });

  it('only proposes lines for riders with something outstanding', () => {
    const allBilled = trips.map((t) => ({ ...t, settlementId: 'st_1' }));
    const tallies = tallyRiders({ carpool, riders: [riders[0]], trips: allBilled, people, range: monthRange('2026-09-15') });
    expect(settlementLines(tallies)).toEqual([]);
  });

  it('builds settlement lines from the unbilled totals', () => {
    const tallies = tallyRiders({ carpool, riders: [riders[0]], trips, people, range: monthRange('2026-09-15') });
    const lines = settlementLines(tallies);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ personName: 'Sara', trips: 2, amount: rs(300), txnId: null });
  });

  it('selects exactly the trips a settlement covers', () => {
    const covered = tripsToSettle(trips, monthRange('2026-09-15'), ['rd_sara']);
    expect(covered.map((t) => t.id).sort()).toEqual(['tp_2', 'tp_3']);
  });

  it('leaves other riders trips alone when billing one person', () => {
    const mixed = [
      trip('tp_a', '2026-09-01', ['rd_sara']),
      trip('tp_b', '2026-09-02', ['rd_bilal']),
    ];
    expect(tripsToSettle(mixed, monthRange('2026-09-15'), ['rd_sara']).map((t) => t.id)).toEqual(['tp_a']);
  });

  it('lists unbilled trips', () => {
    expect(unbilledTrips(trips).map((t) => t.id)).toEqual(['tp_2', 'tp_3']);
  });
});

describe('not forgetting to log', () => {
  it('flags weekdays with nothing recorded', () => {
    // 2026-09-15 is a Tuesday. Trips on Mon 14 and Fri 11 only.
    const trips = [trip('tp_1', '2026-09-14', ['rd_sara']), trip('tp_2', '2026-09-11', ['rd_sara'])];
    const gap = findLoggingGaps(trips, '2026-09-15');

    expect(gap.missingToday).toBe(true);
    expect(gap.lastTripDate).toBe('2026-09-14');
    expect(gap.daysSinceLastTrip).toBe(1);
  });

  it('ignores weekends, since the university run does not happen then', () => {
    // 2026-09-07 is a Monday; 5th and 6th are the weekend.
    const trips = [trip('tp_1', '2026-09-04', ['rd_sara'])];
    const gap = findLoggingGaps(trips, '2026-09-07', 5);
    expect(gap.unloggedWeekdays).not.toContain('2026-09-05');
    expect(gap.unloggedWeekdays).not.toContain('2026-09-06');
  });

  it('says nothing is missing when today is already logged', () => {
    const trips = [trip('tp_1', '2026-09-15', ['rd_sara'])];
    expect(findLoggingGaps(trips, '2026-09-15').missingToday).toBe(false);
  });

  it('copes with no trips at all', () => {
    const gap = findLoggingGaps([], '2026-09-15');
    expect(gap.lastTripDate).toBeNull();
    expect(gap.daysSinceLastTrip).toBeNull();
    expect(gap.missingToday).toBe(true);
  });
});

describe('smart defaults', () => {
  it('offers the riders from the most recent trip', () => {
    const trips = [
      trip('tp_1', '2026-09-01', ['rd_sara']),
      trip('tp_2', '2026-09-04', ['rd_sara', 'rd_bilal']),
      trip('tp_3', '2026-09-02', ['rd_ali']),
    ];
    expect(lastRiders(trips)).toEqual(['rd_sara', 'rd_bilal']);
    expect(lastRiders([])).toEqual([]);
  });

  it('totals everything the carpool has ever been worth', () => {
    const trips = [
      trip('tp_1', '2026-09-01', ['rd_sara', 'rd_bilal']),
      trip('tp_2', '2026-09-03', ['rd_ali'], { rd_ali: rs(200) }),
    ];
    expect(lifetimeValue(trips, riders, carpool)).toBe(rs(500)); // 150 + 150 + 200
  });
});

describe('edge cases', () => {
  it('handles a trip with nobody on it', () => {
    const tallies = tallyRiders({ carpool, riders, trips: [trip('tp_1', '2026-09-01', [])], people, range: monthRange('2026-09-15') });
    expect(tallies.every((t) => t.trips === 0)).toBe(true);
    expect(settlementLines(tallies)).toEqual([]);
  });

  it('handles a rider whose person was removed', () => {
    const tallies = tallyRiders({
      carpool, riders: [rider('rd_ghost', 'per_missing')],
      trips: [trip('tp_1', '2026-09-01', ['rd_ghost'])],
      people, range: monthRange('2026-09-15'),
    });
    expect(tallies[0].name).toBe('Unknown rider');
    expect(tallies[0].amount).toBe(rs(150));
  });

  it('handles a zero rate without inventing a charge', () => {
    const free: Carpool = { ...carpool, ratePerTrip: 0 };
    const tallies = tallyRiders({
      carpool: free, riders: [rider('rd_free', 'per_sara', 0)],
      trips: [trip('tp_1', '2026-09-01', ['rd_free'], { rd_free: 0 })],
      people, range: monthRange('2026-09-15'),
    });
    expect(tallies[0].amount).toBe(0);
    expect(settlementLines(tallies)).toEqual([]);
  });

  it('keeps an inactive rider visible while they still have trips in the period', () => {
    const left = { ...rider('rd_gone', 'per_bilal'), active: false };
    const tallies = tallyRiders({
      carpool, riders: [left],
      trips: [trip('tp_1', '2026-09-01', ['rd_gone'])],
      people, range: monthRange('2026-09-15'),
    });
    expect(tallies).toHaveLength(1);
    expect(tallies[0].amount).toBe(rs(150));
  });

  it('drops an inactive rider with no trips', () => {
    const left = { ...rider('rd_gone', 'per_bilal'), active: false };
    const tallies = tallyRiders({ carpool, riders: [left], trips: [], people, range: monthRange('2026-09-15') });
    expect(tallies).toEqual([]);
  });
});
