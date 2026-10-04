import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore';
import { rs } from '../test/fixtures';
import { settlementLines, summarisePeriod } from '../core/carpool';
import { monthRange } from '../core/dates';
import { balanceOf, computeBalances } from '../core/projections';
import type { Carpool, CarpoolRider, CarpoolTrip, Person } from '../core/types';

let ns = 0;
const s = () => useStore.getState();
const stamp = '2026-09-01T08:00:00.000Z';

async function carpoolWithRider(categoryId: string | null) {
  const carpool: Carpool = {
    id: 'cp_b', name: 'Office run', ratePerTrip: rs(350), currency: 'PKR', settleAs: 'recovery',
    settleCategoryId: categoryId, notes: null, archived: false, createdAt: stamp, updatedAt: stamp,
  };
  await s().saveCarpool(carpool, true);
  // The carpool's own "New person": a person with no ledger accounts yet.
  const person: Person = { id: 'per_hassan', name: 'Hassan', contact: null, notes: null, color: null, archived: false, createdAt: stamp, updatedAt: stamp };
  await s().savePerson(person, true);
  const rider: CarpoolRider = { id: 'rd_hassan', carpoolId: carpool.id, personId: person.id, ratePerTrip: null, active: true, createdAt: stamp, updatedAt: stamp };
  await s().saveCarpoolRider(rider, true);
  for (const day of ['2026-09-02', '2026-09-03']) {
    const trip: CarpoolTrip = { id: `tp_${day}`, carpoolId: carpool.id, date: day, riderIds: [rider.id], rates: { [rider.id]: rs(350) }, note: null, settlementId: null, createdAt: stamp, updatedAt: stamp };
    await s().logTrip(trip, true);
  }
  const range = monthRange('2026-09-15');
  const summary = summarisePeriod({ carpool, riders: [rider], trips: s().carpoolTrips, people: s().people, range });
  return { carpool, range, lines: settlementLines(summary.riders) };
}

describe('billing a carpool rider', () => {
  beforeEach(async () => {
    await s().init(`bill_${Date.now()}_${++ns}`);
  });

  it('bills a rider who has never been billed and has no ledger account yet', async () => {
    const fuel = s().accounts.find((a) => a.class === 'expense_category')!.id;
    const { carpool, range, lines } = await carpoolWithRider(fuel);
    expect(s().accounts.some((a) => a.personId === 'per_hassan')).toBe(false);

    const result = await s().settleCarpool(carpool.id, range, lines);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);

    const receivable = s().accounts.find((a) => a.class === 'receivable' && a.personId === 'per_hassan')!;
    expect(balanceOf(computeBalances(s().transactions.filter((t) => !t.voided)), receivable.id)).toBe(rs(700));
  });

  it('says plainly when the carpool category is unknown on this device', async () => {
    const { carpool, range, lines } = await carpoolWithRider('acc_from_another_device');
    const result = await s().settleCarpool(carpool.id, range, lines);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Choose the category carpool money counts against.');
  });
});
