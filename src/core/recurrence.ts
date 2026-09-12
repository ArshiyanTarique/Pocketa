/**
 * Recurring transactions: bills, subscriptions, salary.
 *
 * Two rules shape this file.
 *
 * R8 — A template is never mutated by one occurrence. If April's electricity
 *      bill is Rs. 4,800 instead of the usual Rs. 4,000, that fact is recorded
 *      as an OccurrenceOverride keyed to April. May still expects Rs. 4,000.
 *
 * R9 — A missed occurrence is never silently dropped. Dates that have passed
 *      without being paid or explicitly skipped surface as `overdue` and keep
 *      surfacing until the user acts on them.
 *
 * Occurrence dates are always computed as an OFFSET FROM THE TEMPLATE START,
 * never by stepping forward from the previous occurrence. Stepping accumulates
 * drift: a bill due on the 31st would land on the 28th in February and then
 * stay on the 28th forever. Indexing from the start restores the 31st in March.
 */

import {
  addDays,
  addMonths,
  addYears,
  compareDates,
  daysBetween,
  today,
  withDayOfMonth,
  type CalendarDate,
  type DateRange,
} from './dates';
import type {
  ID,
  OccurrenceOverride,
  OccurrenceStatus,
  Recurrence,
} from './types';

/** Stable identity for one occurrence of one template. */
export function occurrenceKey(recurrenceId: ID, dueDate: CalendarDate): string {
  return `${recurrenceId}:${dueDate}`;
}

/** The nth scheduled date for a template, counting from 0 at startDate. */
export function nthOccurrence(rec: Recurrence, n: number): CalendarDate {
  const step = Math.max(1, rec.interval || 1);
  switch (rec.frequency) {
    case 'daily':
      return addDays(rec.startDate, n * step);
    case 'custom_days':
      return addDays(rec.startDate, n * step);
    case 'weekly':
      return addDays(rec.startDate, n * step * 7);
    case 'yearly':
      return addYears(rec.startDate, n * step);
    case 'monthly':
    default: {
      const shifted = addMonths(rec.startDate, n * step);
      // Re-expand the day so a 31st bill returns to the 31st after February.
      const day = rec.byMonthDay ?? Number(rec.startDate.slice(8, 10));
      return withDayOfMonth(shifted, day);
    }
  }
}

/** Rough number of occurrences per year, for annualising a subscription cost. */
export function occurrencesPerYear(rec: Recurrence): number {
  const step = Math.max(1, rec.interval || 1);
  switch (rec.frequency) {
    case 'daily':
    case 'custom_days':
      return 365 / step;
    case 'weekly':
      return 52 / step;
    case 'yearly':
      return 1 / step;
    case 'monthly':
    default:
      return 12 / step;
  }
}

const MAX_ITERATIONS = 5000;

/**
 * Every scheduled date for a template that falls inside `range`.
 * Respects endDate and maxOccurrences.
 */
export function occurrencesBetween(rec: Recurrence, range: DateRange): CalendarDate[] {
  const out: CalendarDate[] = [];
  if (rec.startDate > range.to) return out;

  const limit = rec.maxOccurrences ?? Infinity;
  for (let n = 0; n < MAX_ITERATIONS && out.length < limit; n++) {
    const d = nthOccurrence(rec, n);
    if (rec.endDate && d > rec.endDate) break;
    if (d > range.to) break;
    if (d >= range.from) out.push(d);
    // A safety valve: if the sequence stops advancing, stop rather than spin.
    if (n > 0 && d <= nthOccurrence(rec, n - 1)) break;
  }
  return out;
}

/** The next scheduled date strictly after `after`, or null if the series ended. */
export function nextOccurrence(rec: Recurrence, after: CalendarDate = today()): CalendarDate | null {
  const limit = rec.maxOccurrences ?? Infinity;
  for (let n = 0; n < MAX_ITERATIONS && n < limit; n++) {
    const d = nthOccurrence(rec, n);
    if (rec.endDate && d > rec.endDate) return null;
    if (d > after) return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Occurrence views
// ---------------------------------------------------------------------------

export interface OccurrenceView {
  key: string;
  recurrence: Recurrence;
  dueDate: CalendarDate;
  /** The override amount when one exists, otherwise the template amount. */
  amount: number;
  /** True when this occurrence's amount differs from the template. */
  amountChanged: boolean;
  status: OccurrenceStatus;
  override: OccurrenceOverride | null;
  txnId: ID | null;
  /** Negative when overdue, positive when still ahead. */
  daysUntilDue: number;
}

export interface BuildOccurrencesOptions {
  recurrences: readonly Recurrence[];
  overrides: readonly OccurrenceOverride[];
  range: DateRange;
  asOf?: CalendarDate;
}

/**
 * Expand templates into concrete occurrences across a window, applying any
 * per-occurrence overrides on top WITHOUT touching the template itself.
 */
export function buildOccurrences(opts: BuildOccurrencesOptions): OccurrenceView[] {
  const asOf = opts.asOf ?? today();

  const overrideByKey = new Map<string, OccurrenceOverride>();
  for (const o of opts.overrides) {
    overrideByKey.set(occurrenceKey(o.recurrenceId, o.dueDate), o);
  }

  const views: OccurrenceView[] = [];
  for (const rec of opts.recurrences) {
    if (rec.archived) continue;
    for (const dueDate of occurrencesBetween(rec, opts.range)) {
      const key = occurrenceKey(rec.id, dueDate);
      const override = overrideByKey.get(key) ?? null;

      // R8: the override supplies the amount for THIS date only.
      const amount = override?.amount ?? rec.amount;

      views.push({
        key,
        recurrence: rec,
        dueDate,
        amount,
        amountChanged: override?.amount != null && override.amount !== rec.amount,
        status: statusFor(rec, dueDate, override, asOf),
        override,
        txnId: override?.txnId ?? null,
        daysUntilDue: daysBetween(asOf, dueDate),
      });
    }
  }

  return views.sort((a, b) => compareDates(a.dueDate, b.dueDate) || a.recurrence.name.localeCompare(b.recurrence.name));
}

/**
 * Resolve an occurrence's status.
 *
 * Explicit user actions (paid, skipped) always win. Otherwise the date decides:
 * past its due date means overdue — never "gone".
 */
export function statusFor(
  rec: Recurrence,
  dueDate: CalendarDate,
  override: OccurrenceOverride | null,
  asOf: CalendarDate = today(),
): OccurrenceStatus {
  if (override?.status === 'paid' || override?.txnId) return 'paid';
  if (override?.status === 'skipped') return 'skipped';

  const days = daysBetween(asOf, dueDate);
  if (days < 0) return 'overdue'; // R9 — missed, and it stays visible
  if (days === 0) return 'due';
  if (days <= Math.max(0, rec.leadDays ?? 7)) return 'upcoming';
  return 'upcoming';
}

/**
 * Occurrences that still need money: due, overdue, or upcoming within `horizon`
 * days. This is exactly the set Safe-to-Spend must reserve against.
 */
export function unpaidObligations(
  views: readonly OccurrenceView[],
  horizonDays: number,
  asOf: CalendarDate = today(),
): OccurrenceView[] {
  const horizonDate = addDays(asOf, horizonDays);
  return views.filter(
    (v) =>
      (v.status === 'due' || v.status === 'overdue' || v.status === 'upcoming') &&
      v.dueDate <= horizonDate,
  );
}

export function overdueOccurrences(views: readonly OccurrenceView[]): OccurrenceView[] {
  return views.filter((v) => v.status === 'overdue');
}

/**
 * Occurrences that should have been posted by now but have no override at all —
 * the ones a user never saw because the app was closed. Surfacing these is the
 * whole of R9.
 */
export function missedOccurrences(
  views: readonly OccurrenceView[],
): OccurrenceView[] {
  return views.filter((v) => v.status === 'overdue' && v.override === null);
}

// ---------------------------------------------------------------------------
// Describing a schedule in words
// ---------------------------------------------------------------------------

const ORDINALS = ['th', 'st', 'nd', 'rd'];
function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${ORDINALS[(v - 20) % 10] ?? ORDINALS[v] ?? ORDINALS[0]}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function describeRecurrence(rec: Recurrence): string {
  const step = Math.max(1, rec.interval || 1);
  switch (rec.frequency) {
    case 'daily':
      return step === 1 ? 'Every day' : `Every ${step} days`;
    case 'custom_days':
      return `Every ${step} day${step === 1 ? '' : 's'}`;
    case 'weekly': {
      const day = rec.byWeekday != null ? WEEKDAYS[rec.byWeekday] : null;
      const base = step === 1 ? 'Every week' : `Every ${step} weeks`;
      return day ? `${base} on ${day}` : base;
    }
    case 'yearly':
      return step === 1 ? 'Every year' : `Every ${step} years`;
    case 'monthly':
    default: {
      const day = rec.byMonthDay ?? Number(rec.startDate.slice(8, 10));
      const base = step === 1 ? 'Monthly' : `Every ${step} months`;
      return `${base} on the ${ordinal(day)}`;
    }
  }
}

/** A note shown when a schedule cannot land on its nominal day every month. */
export function clampNote(rec: Recurrence): string | null {
  if (rec.frequency !== 'monthly') return null;
  const day = rec.byMonthDay ?? Number(rec.startDate.slice(8, 10));
  if (day <= 28) return null;
  return `In shorter months this falls on the last day instead of the ${ordinal(day)}.`;
}
