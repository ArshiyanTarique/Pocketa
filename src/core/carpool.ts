/**
 * Carpool tallying.
 *
 * A trip is a tally mark, not a transaction. Nothing here touches the ledger;
 * it counts rides and works out what each person owes. Money enters the ledger
 * only when a period is billed, at which point `buildCarpoolSettlement` turns
 * each rider's total into a receivable.
 *
 * That separation matters. If a ride were recorded as income the moment it
 * happened, every monthly figure would include money nobody has handed over —
 * and the whole app is built on not doing that.
 */

import { sumMinor } from './money';
import { addDays, daysBetween, monthRange, today, type CalendarDate, type DateRange } from './dates';
import type {
  Carpool,
  CarpoolRider,
  CarpoolSettlementLine,
  CarpoolTrip,
  ID,
  Person,
} from './types';

/** What a rider is charged per trip: their own rate, else the carpool's. */
export function rateForRider(rider: CarpoolRider, carpool: Carpool): number {
  return rider.ratePerTrip ?? carpool.ratePerTrip;
}

/**
 * The rate actually applied to a rider on a given trip.
 *
 * Frozen onto the trip when it was logged, so raising the rate today never
 * re-prices last month. Falls back to the live rate only for a trip recorded
 * before rates were captured.
 */
export function rateOnTrip(trip: CarpoolTrip, riderId: ID, fallback: number): number {
  const frozen = trip.rates?.[riderId];
  return typeof frozen === 'number' && Number.isFinite(frozen) ? frozen : fallback;
}

export function tripsInRange(trips: readonly CarpoolTrip[], range: DateRange): CarpoolTrip[] {
  return trips
    .filter((t) => t.date >= range.from && t.date <= range.to)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function unbilledTrips(trips: readonly CarpoolTrip[]): CarpoolTrip[] {
  return trips.filter((t) => t.settlementId == null);
}

export interface RiderTally {
  rider: CarpoolRider;
  person: Person | undefined;
  name: string;
  trips: number;
  /** Trips that have not yet been billed. */
  unbilledTrips: number;
  /** Owed for the unbilled trips, in minor units. */
  amount: number;
  /** Already billed in this range, so it is visible but not charged again. */
  billedAmount: number;
  rate: number;
  lastRode: CalendarDate | null;
}

export interface TallyInput {
  carpool: Carpool;
  riders: readonly CarpoolRider[];
  trips: readonly CarpoolTrip[];
  people: readonly Person[];
  range: DateRange;
  /** Include riders with no trips in the period. Default false. */
  includeInactive?: boolean;
}

/**
 * Work out what each rider owes for a period.
 *
 * Billed and unbilled trips are counted separately: the total tells you what
 * the month looked like, the unbilled figure is what there is left to charge.
 * A trip already settled can never be swept into a second invoice.
 */
export function tallyRiders(input: TallyInput): RiderTally[] {
  const inRange = tripsInRange(input.trips, input.range);
  const peopleById = new Map(input.people.map((p) => [p.id, p]));

  const tallies = input.riders.map((rider) => {
    const rate = rateForRider(rider, input.carpool);
    const ridden = inRange.filter((t) => t.riderIds.includes(rider.id));
    const unbilled = ridden.filter((t) => t.settlementId == null);
    const billed = ridden.filter((t) => t.settlementId != null);

    return {
      rider,
      person: peopleById.get(rider.personId),
      name: peopleById.get(rider.personId)?.name ?? 'Unknown rider',
      trips: ridden.length,
      unbilledTrips: unbilled.length,
      amount: sumMinor(unbilled.map((t) => rateOnTrip(t, rider.id, rate))),
      billedAmount: sumMinor(billed.map((t) => rateOnTrip(t, rider.id, rate))),
      rate,
      lastRode: ridden[0]?.date ?? null,
    };
  });

  return tallies
    .filter((t) => input.includeInactive || t.trips > 0 || t.rider.active)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

export interface PeriodSummary {
  range: DateRange;
  tripCount: number;
  unbilledTripCount: number;
  /** Total outstanding across all riders for this period. */
  outstanding: number;
  /** Total already billed for this period. */
  billed: number;
  riders: RiderTally[];
}

export function summarisePeriod(input: TallyInput): PeriodSummary {
  const riders = tallyRiders(input);
  const inRange = tripsInRange(input.trips, input.range);
  return {
    range: input.range,
    tripCount: inRange.length,
    unbilledTripCount: inRange.filter((t) => t.settlementId == null).length,
    outstanding: sumMinor(riders.map((r) => r.amount)),
    billed: sumMinor(riders.map((r) => r.billedAmount)),
    riders,
  };
}

/** The lines a settlement will create. Riders owing nothing are left out. */
export function settlementLines(tallies: readonly RiderTally[]): CarpoolSettlementLine[] {
  return tallies
    .filter((t) => t.amount > 0 && t.unbilledTrips > 0)
    .map((t) => ({
      riderId: t.rider.id,
      personId: t.rider.personId,
      personName: t.name,
      trips: t.unbilledTrips,
      amount: t.amount,
      txnId: null,
    }));
}

/** Trips a settlement covers: unbilled, in range, ridden by at least one billed rider. */
export function tripsToSettle(
  trips: readonly CarpoolTrip[],
  range: DateRange,
  riderIds: readonly ID[],
): CarpoolTrip[] {
  return tripsInRange(trips, range).filter(
    (t) => t.settlementId == null && t.riderIds.some((id) => riderIds.includes(id)),
  );
}

// ---------------------------------------------------------------------------
// Nudges — the point of the feature is not forgetting
// ---------------------------------------------------------------------------

export interface LoggingGap {
  /** Weekdays since the last logged trip with no entry at all. */
  daysSinceLastTrip: number | null;
  lastTripDate: CalendarDate | null;
  /** True when today has no trip logged yet. */
  missingToday: boolean;
  /** Recent weekdays with no trip, most recent first. Excludes today. */
  unloggedWeekdays: CalendarDate[];
}

/**
 * Look back for weekdays with nothing recorded.
 *
 * The user's stated problem is forgetting to write trips down, so the app has
 * to volunteer the gap rather than wait to be asked. Weekends are ignored
 * because a university run does not happen on them.
 */
export function findLoggingGaps(
  trips: readonly CarpoolTrip[],
  asOf: CalendarDate = today(),
  lookbackDays = 10,
): LoggingGap {
  const logged = new Set(trips.map((t) => t.date));
  const sorted = [...trips].sort((a, b) => b.date.localeCompare(a.date));
  const lastTripDate = sorted[0]?.date ?? null;

  const unloggedWeekdays: CalendarDate[] = [];
  for (let i = 1; i <= lookbackDays; i++) {
    const day = addDays(asOf, -i);
    if (isWeekend(day)) continue;
    if (!logged.has(day)) unloggedWeekdays.push(day);
    // Stop looking once we reach a point before the carpool started.
    if (lastTripDate && day < lastTripDate) break;
  }

  return {
    daysSinceLastTrip: lastTripDate ? daysBetween(lastTripDate, asOf) : null,
    lastTripDate,
    missingToday: !logged.has(asOf),
    unloggedWeekdays,
  };
}

function isWeekend(date: CalendarDate): boolean {
  // Uses the same integer day-number arithmetic as the rest of the app, so it
  // cannot be shifted by a time zone.
  const dow = ((toDayNumberLocal(date) % 7) + 11) % 7;
  return dow === 0 || dow === 6;
}

function toDayNumberLocal(date: CalendarDate): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Riders on the most recent trip — the sensible default for the next one. */
export function lastRiders(trips: readonly CarpoolTrip[]): ID[] {
  const sorted = [...trips].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
  return sorted[0]?.riderIds ?? [];
}

/** Total ever earned from a carpool, billed or not. */
export function lifetimeValue(
  trips: readonly CarpoolTrip[],
  riders: readonly CarpoolRider[],
  carpool: Carpool,
): number {
  let total = 0;
  for (const trip of trips) {
    for (const riderId of trip.riderIds) {
      const rider = riders.find((r) => r.id === riderId);
      total += rateOnTrip(trip, riderId, rider ? rateForRider(rider, carpool) : carpool.ratePerTrip);
    }
  }
  return total;
}

export { monthRange };
