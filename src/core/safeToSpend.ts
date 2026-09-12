/**
 * Safe to Spend.
 *
 * A transparent budgeting arithmetic, not advice (business rule R12). Every
 * result carries the full line-by-line derivation that produced it, and the UI
 * is required to show that derivation rather than a bare number — a figure the
 * user cannot audit is a figure they cannot trust with their rent.
 *
 *     liquid balances
 *   − unpaid bills falling due inside the horizon
 *   − goal contributions still planned this month
 *   − outstanding credit-card balances
 *   = safe to spend
 */

import { addDays, today, endOfMonth, type CalendarDate } from './dates';
import { sumMinor } from './money';
import { balanceOfBase, type Balances } from './projections';
import type { OccurrenceView } from './recurrence';
import { LIQUID_CLASSES, type Account, type Goal, type ID, type Transaction } from './types';

export interface SafeToSpendLine {
  key: string;
  label: string;
  /** Plain-language explanation of where this number came from. */
  detail: string;
  /** Signed: positive contributes, negative deducts. */
  amount: number;
  kind: 'start' | 'deduction';
  /** Ids the user can drill into. */
  refs?: ID[];
}

export interface SafeToSpendResult {
  amount: number;
  lines: SafeToSpendLine[];
  horizonDays: number;
  horizonDate: CalendarDate;
  /** True when obligations already exceed liquid funds. */
  shortfall: boolean;
}

export interface SafeToSpendInput {
  accounts: readonly Account[];
  balances: Balances;
  /** Occurrences already expanded for the horizon window. */
  occurrences: readonly OccurrenceView[];
  goals: readonly Goal[];
  txns: readonly Transaction[];
  horizonDays: number;
  reserveGoals: boolean;
  asOf?: CalendarDate;
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const asOf = input.asOf ?? today();
  const horizonDate = addDays(asOf, input.horizonDays);
  const lines: SafeToSpendLine[] = [];

  // 1. What is actually available right now.
  const liquidAccounts = input.accounts.filter(
    (a) => !a.archived && LIQUID_CLASSES.includes(a.class),
  );
  const liquid = sumMinor(liquidAccounts.map((a) => balanceOfBase(input.balances, a.id)));
  lines.push({
    key: 'liquid',
    label: 'Available now',
    detail:
      liquidAccounts.length === 0
        ? 'No cash or bank accounts yet.'
        : `Across ${liquidAccounts.length} account${liquidAccounts.length === 1 ? '' : 's'}: ${liquidAccounts
            .map((a) => a.name)
            .join(', ')}. Investments and goal balances are excluded.`,
    amount: liquid,
    kind: 'start',
    refs: liquidAccounts.map((a) => a.id),
  });

  // 2. Bills that will land before the horizon.
  const dueSoon = input.occurrences.filter(
    (o) =>
      (o.status === 'due' || o.status === 'overdue' || o.status === 'upcoming') &&
      o.dueDate <= horizonDate &&
      o.recurrence.kind === 'expense',
  );
  const billsTotal = sumMinor(dueSoon.map((o) => o.amount));
  if (billsTotal !== 0) {
    const overdueCount = dueSoon.filter((o) => o.status === 'overdue').length;
    lines.push({
      key: 'bills',
      label: 'Bills due',
      detail:
        `${dueSoon.length} unpaid bill${dueSoon.length === 1 ? '' : 's'} in the next ${input.horizonDays} days` +
        (overdueCount > 0 ? `, including ${overdueCount} already overdue.` : '.'),
      amount: -billsTotal,
      kind: 'deduction',
      refs: dueSoon.map((o) => o.key),
    });
  }

  // 3. Goal contributions the user has planned but not yet made this month.
  if (input.reserveGoals) {
    const monthEnd = endOfMonth(asOf);
    const active = input.goals.filter((g) => !g.archived && !g.completedAt && g.plannedContribution);
    let reserved = 0;
    const reservedRefs: ID[] = [];
    for (const goal of active) {
      const contributedThisMonth = contributionsInMonth(input.txns, goal.accountId, asOf);
      const planned = goal.plannedContribution ?? 0;
      const outstanding = Math.max(0, planned - contributedThisMonth);
      if (outstanding > 0) {
        reserved += outstanding;
        reservedRefs.push(goal.id);
      }
    }
    if (reserved > 0) {
      lines.push({
        key: 'goals',
        label: 'Reserved for goals',
        detail: `Planned contributions not yet made before ${monthEnd}. Turn this off in Settings if you would rather not reserve it.`,
        amount: -reserved,
        kind: 'deduction',
        refs: reservedRefs,
      });
    }
  }

  // 4. Card balances already owed. Spent money that has not left the bank yet.
  const cards = input.accounts.filter((a) => !a.archived && a.class === 'credit_card');
  const owed = -sumMinor(
    cards.map((a) => Math.min(0, balanceOfBase(input.balances, a.id))),
  );
  if (owed > 0) {
    lines.push({
      key: 'cards',
      label: 'Card balances owed',
      detail: `Already spent on ${cards.length === 1 ? 'your card' : 'your cards'} and not yet paid off. Counted here so the same rupee is not spent twice.`,
      amount: -owed,
      kind: 'deduction',
      refs: cards.map((a) => a.id),
    });
  }

  const amount = lines.reduce((sum, l) => sum + l.amount, 0);
  return {
    amount,
    lines,
    horizonDays: input.horizonDays,
    horizonDate,
    shortfall: amount < 0,
  };
}

/** Total moved into a goal account during the calendar month containing `asOf`. */
function contributionsInMonth(
  txns: readonly Transaction[],
  goalAccountId: ID,
  asOf: CalendarDate,
): number {
  const month = asOf.slice(0, 7);
  return sumMinor(
    txns
      .filter((t) => !t.voided && t.date.slice(0, 7) === month)
      .flatMap((t) =>
        t.postings.filter((p) => p.accountId === goalAccountId && p.amount > 0).map((p) => p.amount),
      ),
  );
}

// ---------------------------------------------------------------------------
// Financial health
// ---------------------------------------------------------------------------

export type HealthLevel = 'strong' | 'steady' | 'tight' | 'strained';

export interface HealthSignal {
  key: string;
  label: string;
  detail: string;
  tone: 'good' | 'neutral' | 'warn' | 'bad';
}

export interface FinancialHealth {
  level: HealthLevel;
  headline: string;
  signals: HealthSignal[];
}

export interface HealthInput {
  savingsRate: number | null;
  netWorth: number;
  safeToSpend: number;
  overdueBills: number;
  budgetsOver: number;
  budgetsProjectedOver: number;
  monthsOfExpensesCovered: number | null;
}

/**
 * A plain-language read on the month, assembled from signals the user can
 * verify. Deliberately descriptive, never prescriptive — it reports what the
 * numbers say and stops there.
 */
export function assessHealth(input: HealthInput): FinancialHealth {
  const signals: HealthSignal[] = [];

  if (input.savingsRate != null) {
    const pct = Math.round(input.savingsRate * 100);
    signals.push({
      key: 'savings_rate',
      label: `Saving ${pct}% of income`,
      detail:
        pct >= 20
          ? 'Comfortably ahead of spending this month.'
          : pct >= 0
            ? 'Income is covering spending this month.'
            : 'Spending has exceeded income this month.',
      tone: pct >= 20 ? 'good' : pct >= 0 ? 'neutral' : 'bad',
    });
  }

  if (input.overdueBills > 0) {
    signals.push({
      key: 'overdue',
      label: `${input.overdueBills} overdue bill${input.overdueBills === 1 ? '' : 's'}`,
      detail: 'Past the due date and not yet marked paid or skipped.',
      tone: 'bad',
    });
  }

  if (input.budgetsOver > 0) {
    signals.push({
      key: 'budgets_over',
      label: `${input.budgetsOver} budget${input.budgetsOver === 1 ? '' : 's'} exceeded`,
      detail: 'Already past the limit for this period.',
      tone: 'bad',
    });
  } else if (input.budgetsProjectedOver > 0) {
    signals.push({
      key: 'budgets_projected',
      label: `${input.budgetsProjectedOver} budget${input.budgetsProjectedOver === 1 ? '' : 's'} trending over`,
      detail: 'On the current pace these will pass their limit before the period ends.',
      tone: 'warn',
    });
  }

  if (input.safeToSpend < 0) {
    signals.push({
      key: 'shortfall',
      label: 'Obligations exceed available funds',
      detail: 'Upcoming bills and reservations total more than your liquid balance.',
      tone: 'bad',
    });
  }

  if (input.monthsOfExpensesCovered != null) {
    const m = input.monthsOfExpensesCovered;
    signals.push({
      key: 'runway',
      label: `${m.toFixed(1)} months of expenses covered`,
      detail: 'Based on liquid balances against average monthly spending.',
      tone: m >= 3 ? 'good' : m >= 1 ? 'neutral' : 'warn',
    });
  }

  const bad = signals.filter((s) => s.tone === 'bad').length;
  const warn = signals.filter((s) => s.tone === 'warn').length;

  let level: HealthLevel;
  let headline: string;
  if (bad >= 2) {
    level = 'strained';
    headline = 'Several things need attention';
  } else if (bad === 1) {
    level = 'tight';
    headline = 'Mostly on track, with one thing to sort out';
  } else if (warn > 0) {
    level = 'steady';
    headline = 'On track, worth keeping an eye on';
  } else {
    level = 'strong';
    headline = 'Everything looks in order';
  }

  return { level, headline, signals };
}
