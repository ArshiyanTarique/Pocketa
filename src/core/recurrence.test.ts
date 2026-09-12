import { describe, it, expect } from 'vitest';
import {
  nthOccurrence,
  occurrencesBetween,
  nextOccurrence,
  buildOccurrences,
  statusFor,
  unpaidObligations,
  missedOccurrences,
  overdueOccurrences,
  describeRecurrence,
  clampNote,
  occurrenceKey,
  occurrencesPerYear,
} from './recurrence';
import { rs } from '../test/fixtures';
import type { OccurrenceOverride, Recurrence } from './types';

function makeRecurrence(over: Partial<Recurrence> = {}): Recurrence {
  return {
    id: 'rec_1',
    name: 'Electricity',
    kind: 'expense',
    amount: rs(4000),
    currency: 'PKR',
    accountId: 'acc_bank',
    categoryId: 'cat_utilities',
    toAccountId: null,
    merchant: 'K-Electric',
    notes: null,
    tags: [],
    frequency: 'monthly',
    interval: 1,
    byWeekday: null,
    byMonthDay: null,
    startDate: '2026-01-10',
    endDate: null,
    maxOccurrences: null,
    leadDays: 7,
    autoPost: false,
    archived: false,
    isBill: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function makeOverride(over: Partial<OccurrenceOverride> = {}): OccurrenceOverride {
  return {
    id: 'ovr_1',
    recurrenceId: 'rec_1',
    dueDate: '2026-04-10',
    status: 'upcoming',
    amount: null,
    paidDate: null,
    txnId: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('schedule generation', () => {
  it('generates monthly dates from the template start', () => {
    const rec = makeRecurrence({ startDate: '2026-01-10' });
    expect([0, 1, 2, 3].map((n) => nthOccurrence(rec, n))).toEqual([
      '2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10',
    ]);
  });

  it('does not drift when the due day exceeds a short month', () => {
    // The bug this prevents: stepping forward from the previous occurrence
    // pins a 31st bill to the 28th forever after February.
    const rec = makeRecurrence({ startDate: '2026-01-31', byMonthDay: 31 });
    expect([0, 1, 2, 3, 4].map((n) => nthOccurrence(rec, n))).toEqual([
      '2026-01-31',
      '2026-02-28', // clamped
      '2026-03-31', // restored
      '2026-04-30', // clamped
      '2026-05-31', // restored
    ]);
  });

  it('lands on 29 February in a leap year', () => {
    const rec = makeRecurrence({ startDate: '2028-01-29', byMonthDay: 29 });
    expect(nthOccurrence(rec, 1)).toBe('2028-02-29');
    const nonLeap = makeRecurrence({ startDate: '2026-01-29', byMonthDay: 29 });
    expect(nthOccurrence(nonLeap, 1)).toBe('2026-02-28');
  });

  it('handles intervals greater than one', () => {
    const quarterly = makeRecurrence({ startDate: '2026-01-15', interval: 3 });
    expect([0, 1, 2].map((n) => nthOccurrence(quarterly, n))).toEqual([
      '2026-01-15', '2026-04-15', '2026-07-15',
    ]);
  });

  it('handles weekly, daily, custom-day and yearly schedules', () => {
    expect(nthOccurrence(makeRecurrence({ frequency: 'weekly', startDate: '2026-09-01' }), 2)).toBe('2026-09-15');
    expect(nthOccurrence(makeRecurrence({ frequency: 'weekly', interval: 2, startDate: '2026-09-01' }), 1)).toBe('2026-09-15');
    expect(nthOccurrence(makeRecurrence({ frequency: 'daily', startDate: '2026-09-01' }), 5)).toBe('2026-09-06');
    expect(nthOccurrence(makeRecurrence({ frequency: 'custom_days', interval: 10, startDate: '2026-09-01' }), 3)).toBe('2026-10-01');
    expect(nthOccurrence(makeRecurrence({ frequency: 'yearly', startDate: '2026-03-01' }), 2)).toBe('2028-03-01');
  });

  it('crosses a year boundary correctly', () => {
    const rec = makeRecurrence({ startDate: '2026-11-15' });
    expect([0, 1, 2, 3].map((n) => nthOccurrence(rec, n))).toEqual([
      '2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15',
    ]);
  });

  it('lists occurrences inside a window only', () => {
    const rec = makeRecurrence({ startDate: '2026-01-10' });
    expect(occurrencesBetween(rec, { from: '2026-03-01', to: '2026-05-31' })).toEqual([
      '2026-03-10', '2026-04-10', '2026-05-10',
    ]);
  });

  it('respects endDate and maxOccurrences', () => {
    const ending = makeRecurrence({ startDate: '2026-01-10', endDate: '2026-03-31' });
    expect(occurrencesBetween(ending, { from: '2026-01-01', to: '2026-12-31' })).toEqual([
      '2026-01-10', '2026-02-10', '2026-03-10',
    ]);

    const capped = makeRecurrence({ startDate: '2026-01-10', maxOccurrences: 2 });
    expect(occurrencesBetween(capped, { from: '2026-01-01', to: '2026-12-31' })).toHaveLength(2);
  });

  it('returns nothing when the window precedes the start date', () => {
    const rec = makeRecurrence({ startDate: '2026-06-01' });
    expect(occurrencesBetween(rec, { from: '2026-01-01', to: '2026-03-01' })).toEqual([]);
  });

  it('finds the next occurrence after a date', () => {
    const rec = makeRecurrence({ startDate: '2026-01-10' });
    expect(nextOccurrence(rec, '2026-03-10')).toBe('2026-04-10');
    expect(nextOccurrence(makeRecurrence({ startDate: '2026-01-10', endDate: '2026-02-28' }), '2026-03-01')).toBeNull();
  });

  it('annualises frequencies for cost comparison', () => {
    expect(occurrencesPerYear(makeRecurrence({ frequency: 'monthly' }))).toBe(12);
    expect(occurrencesPerYear(makeRecurrence({ frequency: 'weekly' }))).toBe(52);
    expect(occurrencesPerYear(makeRecurrence({ frequency: 'yearly' }))).toBe(1);
    expect(occurrencesPerYear(makeRecurrence({ frequency: 'monthly', interval: 3 }))).toBe(4);
  });
});

describe('R8 — one occurrence never mutates the template', () => {
  it('applies an overridden amount to that date alone', () => {
    const rec = makeRecurrence({ amount: rs(4000), startDate: '2026-01-10' });
    const override = makeOverride({ dueDate: '2026-04-10', amount: rs(4800) });

    const views = buildOccurrences({
      recurrences: [rec],
      overrides: [override],
      range: { from: '2026-03-01', to: '2026-06-30' },
      asOf: '2026-03-01',
    });

    const byDate = Object.fromEntries(views.map((v) => [v.dueDate, v.amount]));
    expect(byDate['2026-03-10']).toBe(rs(4000));
    expect(byDate['2026-04-10']).toBe(rs(4800)); // just this month
    expect(byDate['2026-05-10']).toBe(rs(4000)); // back to normal
    expect(byDate['2026-06-10']).toBe(rs(4000));

    // The template itself is untouched.
    expect(rec.amount).toBe(rs(4000));

    const april = views.find((v) => v.dueDate === '2026-04-10')!;
    expect(april.amountChanged).toBe(true);
    expect(views.find((v) => v.dueDate === '2026-05-10')!.amountChanged).toBe(false);
  });
});

describe('R9 — missed occurrences are never silently skipped', () => {
  it('marks past unpaid dates overdue and keeps them visible', () => {
    const rec = makeRecurrence({ startDate: '2026-06-10' });
    const views = buildOccurrences({
      recurrences: [rec],
      overrides: [],
      range: { from: '2026-06-01', to: '2026-09-30' },
      asOf: '2026-09-01',
    });

    const overdue = overdueOccurrences(views).map((v) => v.dueDate);
    expect(overdue).toEqual(['2026-06-10', '2026-07-10', '2026-08-10']);

    // None of them were ever seen by the user, so all are "missed".
    expect(missedOccurrences(views)).toHaveLength(3);
  });

  it('stops surfacing an occurrence once it is paid or explicitly skipped', () => {
    const rec = makeRecurrence({ startDate: '2026-06-10' });
    const views = buildOccurrences({
      recurrences: [rec],
      overrides: [
        makeOverride({ dueDate: '2026-06-10', status: 'paid', txnId: 'txn_1' }),
        makeOverride({ id: 'ovr_2', dueDate: '2026-07-10', status: 'skipped' }),
      ],
      range: { from: '2026-06-01', to: '2026-09-30' },
      asOf: '2026-09-01',
    });

    const byDate = Object.fromEntries(views.map((v) => [v.dueDate, v.status]));
    expect(byDate['2026-06-10']).toBe('paid');
    expect(byDate['2026-07-10']).toBe('skipped');
    expect(byDate['2026-08-10']).toBe('overdue'); // still unresolved
    expect(missedOccurrences(views)).toHaveLength(1);
  });

  it('a skipped occurrence does not affect any other date', () => {
    const rec = makeRecurrence({ startDate: '2026-01-10' });
    const views = buildOccurrences({
      recurrences: [rec],
      overrides: [makeOverride({ dueDate: '2026-02-10', status: 'skipped' })],
      range: { from: '2026-01-01', to: '2026-04-30' },
      asOf: '2026-01-01',
    });
    expect(views.filter((v) => v.status === 'skipped')).toHaveLength(1);
    expect(views).toHaveLength(4);
  });
});

describe('status resolution', () => {
  const rec = makeRecurrence({ leadDays: 7 });

  it('reports due on the day, overdue after, upcoming before', () => {
    expect(statusFor(rec, '2026-09-01', null, '2026-09-01')).toBe('due');
    expect(statusFor(rec, '2026-08-31', null, '2026-09-01')).toBe('overdue');
    expect(statusFor(rec, '2026-09-05', null, '2026-09-01')).toBe('upcoming');
  });

  it('lets an explicit user action win over the date', () => {
    expect(statusFor(rec, '2026-08-01', makeOverride({ status: 'paid' }), '2026-09-01')).toBe('paid');
    expect(statusFor(rec, '2026-08-01', makeOverride({ status: 'skipped' }), '2026-09-01')).toBe('skipped');
    // A linked transaction implies paid even without an explicit status.
    expect(statusFor(rec, '2026-08-01', makeOverride({ txnId: 'txn_9' }), '2026-09-01')).toBe('paid');
  });
});

describe('obligations for Safe to Spend', () => {
  it('collects unpaid bills inside the horizon, including overdue ones', () => {
    const rec = makeRecurrence({ startDate: '2026-08-10' });
    const views = buildOccurrences({
      recurrences: [rec],
      overrides: [],
      range: { from: '2026-08-01', to: '2026-12-31' },
      asOf: '2026-09-01',
    });

    const due = unpaidObligations(views, 30, '2026-09-01');
    expect(due.map((v) => v.dueDate)).toEqual(['2026-08-10', '2026-09-10']);
    expect(unpaidObligations(views, 45, '2026-09-01').map((v) => v.dueDate)).toEqual([
      '2026-08-10', '2026-09-10', '2026-10-10',
    ]);
  });
});

describe('descriptions', () => {
  it('describes schedules in plain language', () => {
    expect(describeRecurrence(makeRecurrence({ frequency: 'monthly', byMonthDay: 1 }))).toBe('Monthly on the 1st');
    expect(describeRecurrence(makeRecurrence({ frequency: 'monthly', byMonthDay: 22 }))).toBe('Monthly on the 22nd');
    expect(describeRecurrence(makeRecurrence({ frequency: 'monthly', byMonthDay: 3 }))).toBe('Monthly on the 3rd');
    expect(describeRecurrence(makeRecurrence({ frequency: 'monthly', interval: 3, byMonthDay: 5 }))).toBe('Every 3 months on the 5th');
    expect(describeRecurrence(makeRecurrence({ frequency: 'weekly', byWeekday: 1 }))).toBe('Every week on Monday');
    expect(describeRecurrence(makeRecurrence({ frequency: 'daily' }))).toBe('Every day');
    expect(describeRecurrence(makeRecurrence({ frequency: 'yearly' }))).toBe('Every year');
  });

  it('warns when a monthly day cannot occur every month', () => {
    expect(clampNote(makeRecurrence({ byMonthDay: 31 }))).toMatch(/last day/);
    expect(clampNote(makeRecurrence({ byMonthDay: 15 }))).toBeNull();
    expect(clampNote(makeRecurrence({ frequency: 'weekly', byMonthDay: 31 }))).toBeNull();
  });

  it('builds a stable occurrence key', () => {
    expect(occurrenceKey('rec_1', '2026-09-10')).toBe('rec_1:2026-09-10');
  });
});

describe('archived templates', () => {
  it('produces no occurrences', () => {
    const views = buildOccurrences({
      recurrences: [makeRecurrence({ archived: true })],
      overrides: [],
      range: { from: '2026-01-01', to: '2026-12-31' },
      asOf: '2026-09-01',
    });
    expect(views).toEqual([]);
  });
});
