import { describe, it, expect } from 'vitest';
import {
  isLeapYear,
  daysInMonth,
  isValidDate,
  parseDate,
  toDate,
  today,
  addDays,
  addMonths,
  addYears,
  daysBetween,
  toDayNumber,
  fromDayNumber,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  startOfWeek,
  dayOfWeek,
  withDayOfMonth,
  monthRange,
  rangeLengthDays,
  daysElapsed,
  daysRemaining,
  eachMonthStart,
  formatDate,
  formatRelativeDay,
  DateError,
} from './dates';

describe('leap years', () => {
  it('applies the full Gregorian rule', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(1900)).toBe(false); // divisible by 100, not 400
    expect(isLeapYear(2000)).toBe(true); // divisible by 400
    expect(isLeapYear(2100)).toBe(false);
  });

  it('gives February the right length', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it('accepts 29 February only in leap years', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(() => parseDate('2026-02-29')).toThrow(DateError);
  });
});

describe('validation', () => {
  it('rejects malformed and impossible dates', () => {
    for (const bad of ['', '2026-1-1', '2026/01/01', '2026-13-01', '2026-00-10', '2026-04-31', 'yesterday', '20260101']) {
      expect(isValidDate(bad), `expected "${bad}" invalid`).toBe(false);
    }
    expect(isValidDate('2026-09-01')).toBe(true);
  });

  it('rejects non-string input', () => {
    expect(isValidDate(null)).toBe(false);
    expect(isValidDate(20260101)).toBe(false);
    expect(isValidDate(new Date())).toBe(false);
  });
});

describe('day-number round trip', () => {
  it('round-trips every day across a four-year leap window', () => {
    let d = '2024-01-01';
    for (let i = 0; i < 366 * 4; i++) {
      expect(fromDayNumber(toDayNumber(d))).toBe(d);
      d = addDays(d, 1);
    }
  });

  it('anchors on the unix epoch', () => {
    expect(toDayNumber('1970-01-01')).toBe(0);
    expect(fromDayNumber(0)).toBe('1970-01-01');
  });

  it('counts days across a leap day', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // via 29 Feb
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1); // no 29 Feb
  });

  it('counts days across a year boundary', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });
});

describe('addMonths — month-end clamping', () => {
  it('clamps 31 January to the end of February', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('clamps when going backwards too', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-03-30', -1)).toBe('2026-02-28');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-06-15', 18)).toBe('2027-12-15');
    expect(addMonths('2026-06-15', -18)).toBe('2024-12-15');
  });

  it('does not accumulate drift when stepping month by month', () => {
    // A bill on the 31st must return to the 31st in long months, not stay at 28.
    let d = '2026-01-31';
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(d);
      d = withDayOfMonth(addMonths(d, 1), 31);
    }
    expect(seen).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('handles 29 February plus one year', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
  });
});

describe('period boundaries', () => {
  it('finds month starts and ends including February', () => {
    expect(startOfMonth('2026-09-17')).toBe('2026-09-01');
    expect(endOfMonth('2026-09-17')).toBe('2026-09-30');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-12-01')).toBe('2026-12-31');
  });

  it('finds year boundaries', () => {
    expect(startOfYear('2026-09-17')).toBe('2026-01-01');
    expect(endOfYear('2026-09-17')).toBe('2026-12-31');
  });

  it('computes day of week correctly', () => {
    expect(dayOfWeek('1970-01-01')).toBe(4); // Thursday
    expect(dayOfWeek('2026-09-01')).toBe(2); // Tuesday
  });

  it('starts weeks on Monday by default', () => {
    expect(startOfWeek('2026-09-01')).toBe('2026-08-31');
    expect(startOfWeek('2026-08-31')).toBe('2026-08-31');
  });
});

describe('range maths', () => {
  it('measures month lengths', () => {
    expect(rangeLengthDays(monthRange('2026-02-05'))).toBe(28);
    expect(rangeLengthDays(monthRange('2028-02-05'))).toBe(29);
    expect(rangeLengthDays(monthRange('2026-09-05'))).toBe(30);
  });

  it('computes elapsed and remaining days, clamped at both ends', () => {
    const r = monthRange('2026-09-15');
    expect(daysElapsed(r, '2026-09-01')).toBe(1);
    expect(daysElapsed(r, '2026-09-15')).toBe(15);
    expect(daysElapsed(r, '2026-10-20')).toBe(30); // clamped
    expect(daysElapsed(r, '2026-08-20')).toBe(0); // before range

    expect(daysRemaining(r, '2026-09-15')).toBe(15);
    expect(daysRemaining(r, '2026-09-30')).toBe(0);
    expect(daysRemaining(r, '2026-10-05')).toBe(0); // clamped
  });

  it('enumerates month starts inclusively across a year boundary', () => {
    expect(eachMonthStart('2026-11-15', '2027-02-03')).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]);
  });
});

describe('display', () => {
  it('formats dates without touching the Date object', () => {
    expect(formatDate('2026-09-01', 'short')).toBe('1 Sep');
    expect(formatDate('2026-09-01', 'medium')).toBe('1 Sep 2026');
    expect(formatDate('2026-09-01', 'long')).toBe('Tue, 1 September 2026');
    expect(formatDate('2026-09-01', 'month')).toBe('September 2026');
  });

  it('describes days relative to a reference', () => {
    const ref = '2026-09-15';
    expect(formatRelativeDay('2026-09-15', ref)).toBe('Today');
    expect(formatRelativeDay('2026-09-14', ref)).toBe('Yesterday');
    expect(formatRelativeDay('2026-09-16', ref)).toBe('Tomorrow');
    expect(formatRelativeDay('2026-09-18', ref)).toBe('In 3 days');
    expect(formatRelativeDay('2026-09-12', ref)).toBe('3 days ago');
    expect(formatRelativeDay('2025-09-12', ref)).toBe('12 Sep 2025');
  });
});

describe('time-zone independence', () => {
  it('derives today from local wall-clock parts, not from UTC', () => {
    // 31 Dec 2026, 23:30 local. A UTC-based implementation would report 1 Jan
    // for anyone east of UTC and roll the user into the wrong month.
    const localLateNight = new Date(2026, 11, 31, 23, 30, 0);
    expect(today(localLateNight)).toBe('2026-12-31');
  });

  it('derives today correctly just after local midnight', () => {
    const justAfterMidnight = new Date(2026, 0, 1, 0, 15, 0);
    expect(today(justAfterMidnight)).toBe('2026-01-01');
  });

  it('never constructs a Date during arithmetic', () => {
    // Arithmetic is pure string/integer work, so it cannot be perturbed by
    // the host time zone at all.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29'); // European DST weekend
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // US DST weekend
    expect(toDate({ y: 2026, m: 2, d: 28 })).toBe('2026-02-28');
  });
});
