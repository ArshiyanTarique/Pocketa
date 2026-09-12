/**
 * Calendar dates, deliberately timezone-naive.
 *
 * A transaction happened on a DAY, not at a UTC instant. "1 September" must stay
 * 1 September whether the user opens the app in Karachi or Toronto. So calendar
 * dates are stored as 'YYYY-MM-DD' strings and all arithmetic is done on integer
 * year/month/day triples — never by constructing a Date and adding milliseconds,
 * which is how month-end and DST bugs get in (assumption A8).
 *
 * Instants that genuinely are instants (createdAt, op timestamps) use ISO UTC and
 * live in `timestamps.ts` concepts below.
 */

export type CalendarDate = string; // 'YYYY-MM-DD'

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateError';
  }
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m < 1 || m > 12) throw new DateError(`month out of range: ${m}`);
  const table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return m === 2 && isLeapYear(y) ? 29 : table[m - 1];
}

export function isValidYMD(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1000 || y > 9999) return false;
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

export function isValidDate(s: unknown): s is CalendarDate {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  return isValidYMD(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function parseDate(s: CalendarDate): YMD {
  const m = DATE_RE.exec(s);
  if (!m) throw new DateError(`invalid calendar date: ${s}`);
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (!isValidYMD(ymd.y, ymd.m, ymd.d)) throw new DateError(`invalid calendar date: ${s}`);
  return ymd;
}

export function toDate(ymd: YMD): CalendarDate {
  if (!isValidYMD(ymd.y, ymd.m, ymd.d)) {
    throw new DateError(`invalid date parts: ${ymd.y}-${ymd.m}-${ymd.d}`);
  }
  return `${String(ymd.y).padStart(4, '0')}-${String(ymd.m).padStart(2, '0')}-${String(ymd.d).padStart(2, '0')}`;
}

/** Today, in the device's local calendar. Never UTC — the user's "today" is local. */
export function today(now: Date = new Date()): CalendarDate {
  return toDate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isBefore = (a: CalendarDate, b: CalendarDate) => a < b;
export const isAfter = (a: CalendarDate, b: CalendarDate) => a > b;
export const isSameDate = (a: CalendarDate, b: CalendarDate) => a === b;

/** Inclusive on both ends. */
export function isWithin(d: CalendarDate, from: CalendarDate, to: CalendarDate): boolean {
  return d >= from && d <= to;
}

// ---------------------------------------------------------------------------
// Day arithmetic, via a day-number so no Date object is involved
// ---------------------------------------------------------------------------

/** Days since 1970-01-01, computed arithmetically (Howard Hinnant's algorithm). */
export function toDayNumber(date: CalendarDate): number {
  const { y, m, d } = parseDate(date);
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(n: number): CalendarDate {
  let z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return toDate({ y: y + (m <= 2 ? 1 : 0), m, d });
}

export function addDays(date: CalendarDate, n: number): CalendarDate {
  return fromDayNumber(toDayNumber(date) + n);
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/**
 * Add months, clamping the day to the target month's length.
 *
 * 2026-01-31 + 1 month = 2026-02-28   (not 2026-03-03)
 * 2028-01-31 + 1 month = 2028-02-29   (leap year)
 * 2026-03-31 - 1 month = 2026-02-28
 */
export function addMonths(date: CalendarDate, n: number): CalendarDate {
  const { y, m, d } = parseDate(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return toDate({ y: ny, m: nm, d: nd });
}

export function addYears(date: CalendarDate, n: number): CalendarDate {
  const { y, m, d } = parseDate(date);
  const ny = y + n;
  return toDate({ y: ny, m, d: Math.min(d, daysInMonth(ny, m)) });
}

export function startOfMonth(date: CalendarDate): CalendarDate {
  const { y, m } = parseDate(date);
  return toDate({ y, m, d: 1 });
}

export function endOfMonth(date: CalendarDate): CalendarDate {
  const { y, m } = parseDate(date);
  return toDate({ y, m, d: daysInMonth(y, m) });
}

export function startOfYear(date: CalendarDate): CalendarDate {
  return toDate({ ...parseDate(date), m: 1, d: 1 });
}

export function endOfYear(date: CalendarDate): CalendarDate {
  return toDate({ ...parseDate(date), m: 12, d: 31 });
}

export function startOfWeek(date: CalendarDate, weekStartsOn = 1): CalendarDate {
  const dow = dayOfWeek(date);
  const diff = (dow - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}

export function endOfWeek(date: CalendarDate, weekStartsOn = 1): CalendarDate {
  return addDays(startOfWeek(date, weekStartsOn), 6);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: CalendarDate): number {
  return ((toDayNumber(date) % 7) + 11) % 7;
}

/**
 * Set the day-of-month, clamping to month length.
 * Used for recurrences like "the 31st of every month" which must land on
 * 28/29/30 in shorter months without drifting the schedule.
 */
export function withDayOfMonth(date: CalendarDate, day: number): CalendarDate {
  const { y, m } = parseDate(date);
  return toDate({ y, m, d: Math.min(Math.max(1, day), daysInMonth(y, m)) });
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

export interface DateRange {
  from: CalendarDate;
  to: CalendarDate;
}

export function monthRange(date: CalendarDate): DateRange {
  return { from: startOfMonth(date), to: endOfMonth(date) };
}

export function yearRange(date: CalendarDate): DateRange {
  return { from: startOfYear(date), to: endOfYear(date) };
}

export function rangeLengthDays(r: DateRange): number {
  return daysBetween(r.from, r.to) + 1;
}

/** Number of days already elapsed in the range as of `asOf`, clamped to the range. */
export function daysElapsed(r: DateRange, asOf: CalendarDate): number {
  if (asOf < r.from) return 0;
  if (asOf > r.to) return rangeLengthDays(r);
  return daysBetween(r.from, asOf) + 1;
}

/** Days left in the range including `asOf` itself. */
export function daysRemaining(r: DateRange, asOf: CalendarDate): number {
  if (asOf > r.to) return 0;
  if (asOf < r.from) return rangeLengthDays(r);
  return daysBetween(asOf, r.to);
}

export function eachMonthStart(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const out: CalendarDate[] = [];
  let cur = startOfMonth(from);
  const end = startOfMonth(to);
  let guard = 0;
  while (cur <= end && guard++ < 6000) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

export function eachDay(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const out: CalendarDate[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDate(date: CalendarDate, style: 'short' | 'medium' | 'long' | 'month' = 'medium'): string {
  const { y, m, d } = parseDate(date);
  switch (style) {
    case 'short':
      return `${d} ${MONTHS_SHORT[m - 1]}`;
    case 'long':
      return `${DOW_SHORT[dayOfWeek(date)]}, ${d} ${MONTHS_LONG[m - 1]} ${y}`;
    case 'month':
      return `${MONTHS_LONG[m - 1]} ${y}`;
    default:
      return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
  }
}

export function formatMonthShort(date: CalendarDate): string {
  const { y, m } = parseDate(date);
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

/** "Today", "Yesterday", "Tomorrow", or a formatted date. */
export function formatRelativeDay(date: CalendarDate, ref: CalendarDate = today()): string {
  const diff = daysBetween(ref, date);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff <= 6) return `In ${diff} days`;
  if (diff < -1 && diff >= -6) return `${-diff} days ago`;
  return formatDate(date, parseDate(date).y === parseDate(ref).y ? 'short' : 'medium');
}

/** Current UTC instant, for op timestamps and audit records. */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}
