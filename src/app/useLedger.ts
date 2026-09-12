/**
 * Derived views over the ledger.
 *
 * Everything here is recomputed from transactions rather than read from a
 * cached total, so a figure on screen can never disagree with the ledger behind
 * it. Memoised on the inputs that actually affect the result.
 */

import * as React from 'react';
import { useStore } from '../store/useStore';
import {
  computeBalances,
  computeNetWorth,
  currentMonthSummary,
  budgetStatus,
  live,
  type Balances,
  type BudgetStatus,
} from '../core/projections';
import { buildOccurrences, unpaidObligations, type OccurrenceView } from '../core/recurrence';
import { computeSafeToSpend, assessHealth, type SafeToSpendResult, type FinancialHealth } from '../core/safeToSpend';
import { addDays, addMonths, monthRange, today, type CalendarDate } from '../core/dates';
import { CATEGORY_CLASSES, SPENDABLE_CLASSES, type Account, type ID } from '../core/types';

export function useToday(): CalendarDate {
  // Recomputed per render is fine; the value is stable within a session and a
  // stale "today" across midnight is corrected on the next interaction.
  return React.useMemo(() => today(), []);
}

export function useAccountMap(): Map<ID, Account> {
  const accounts = useStore((s) => s.accounts);
  return React.useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
}

export function useBalances(): Balances {
  const transactions = useStore((s) => s.transactions);
  return React.useMemo(() => computeBalances(transactions), [transactions]);
}

/** Accounts a user can spend from or into, in display order. */
export function useSpendableAccounts(includeArchived = false): Account[] {
  const accounts = useStore((s) => s.accounts);
  return React.useMemo(
    () =>
      accounts
        .filter((a) => SPENDABLE_CLASSES.includes(a.class) && (includeArchived || !a.archived))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [accounts, includeArchived],
  );
}

export interface CategoryTree {
  parent: Account;
  children: Account[];
}

export function useCategories(
  kind: 'expense_category' | 'income_category',
  includeArchived = false,
): CategoryTree[] {
  const accounts = useStore((s) => s.accounts);
  return React.useMemo(() => {
    const all = accounts.filter((a) => a.class === kind && (includeArchived || !a.archived));
    const parents = all
      .filter((a) => !a.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    return parents.map((parent) => ({
      parent,
      children: all
        .filter((c) => c.parentId === parent.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    }));
  }, [accounts, kind, includeArchived]);
}

/** A flat, searchable list of every selectable category. */
export function useFlatCategories(
  kind: 'expense_category' | 'income_category',
): Array<Account & { path: string }> {
  const accounts = useStore((s) => s.accounts);
  return React.useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return accounts
      .filter((a) => a.class === kind && !a.archived)
      .map((a) => ({
        ...a,
        path: a.parentId ? `${byId.get(a.parentId)?.name ?? ''} › ${a.name}` : a.name,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [accounts, kind]);
}

export function useCategoryLookup(): (id: ID) => Account | undefined {
  const map = useAccountMap();
  return React.useCallback((id: ID) => map.get(id), [map]);
}

/** Occurrences across a window wide enough for bills, dashboards and reserves. */
export function useOccurrences(months = 3): OccurrenceView[] {
  const recurrences = useStore((s) => s.recurrences);
  const overrides = useStore((s) => s.overrides);
  const asOf = useToday();

  return React.useMemo(
    () =>
      buildOccurrences({
        recurrences,
        overrides,
        // Look back far enough to surface anything missed while the app was closed.
        range: { from: addMonths(asOf, -6), to: addMonths(asOf, months) },
        asOf,
      }),
    [recurrences, overrides, asOf, months],
  );
}

export function useUpcomingBills(horizonDays = 30): OccurrenceView[] {
  const occurrences = useOccurrences();
  const asOf = useToday();
  return React.useMemo(
    () => unpaidObligations(occurrences, horizonDays, asOf).filter((o) => o.recurrence.kind === 'expense'),
    [occurrences, horizonDays, asOf],
  );
}

export function useSafeToSpend(): SafeToSpendResult {
  const accounts = useStore((s) => s.accounts);
  const transactions = useStore((s) => s.transactions);
  const goals = useStore((s) => s.goals);
  const settings = useStore((s) => s.settings);
  const balances = useBalances();
  const occurrences = useOccurrences();
  const asOf = useToday();

  return React.useMemo(
    () =>
      computeSafeToSpend({
        accounts,
        balances,
        occurrences,
        goals,
        txns: transactions,
        horizonDays: settings.safeToSpendHorizon,
        reserveGoals: settings.safeToSpendReserveGoals,
        asOf,
      }),
    [accounts, balances, occurrences, goals, transactions, settings.safeToSpendHorizon, settings.safeToSpendReserveGoals, asOf],
  );
}

export function useBudgetStatuses(): BudgetStatus[] {
  const budgets = useStore((s) => s.budgets);
  const transactions = useStore((s) => s.transactions);
  const accounts = useAccountMap();
  const asOf = useToday();

  return React.useMemo(
    () =>
      budgets
        .filter((b) => !b.archived)
        .map((b) => budgetStatus(b, transactions, accounts, asOf))
        .sort((a, b) => b.used - a.used),
    [budgets, transactions, accounts, asOf],
  );
}

export interface Overview {
  netWorth: ReturnType<typeof computeNetWorth>;
  month: ReturnType<typeof currentMonthSummary>;
  safeToSpend: SafeToSpendResult;
  budgets: BudgetStatus[];
  bills: OccurrenceView[];
  overdue: OccurrenceView[];
  health: FinancialHealth;
}

export function useOverview(): Overview {
  const transactions = useStore((s) => s.transactions);
  const accounts = useAccountMap();
  const balances = useBalances();
  const asOf = useToday();

  const safeToSpend = useSafeToSpend();
  const budgets = useBudgetStatuses();
  const occurrences = useOccurrences();

  return React.useMemo(() => {
    const netWorth = computeNetWorth(balances, accounts);
    const month = currentMonthSummary(transactions, accounts, asOf);
    const bills = unpaidObligations(occurrences, 30, asOf).filter((o) => o.recurrence.kind === 'expense');
    const overdue = bills.filter((b) => b.status === 'overdue');

    // Three months of spending gives a steadier runway figure than one.
    const window = [0, 1, 2].map((i) => {
      const range = monthRange(addMonths(asOf, -i));
      return live(transactions)
        .filter((t) => t.date >= range.from && t.date <= range.to)
        .flatMap((t) => t.postings)
        .filter((p) => accounts.get(p.accountId)?.class === 'expense_category')
        .reduce((sum, p) => sum + p.baseAmount, 0);
    });
    const avgMonthlySpend = window.reduce((a, b) => a + b, 0) / 3;
    const liquid = safeToSpend.lines.find((l) => l.key === 'liquid')?.amount ?? 0;

    const health = assessHealth({
      savingsRate: month.savingsRate,
      netWorth: netWorth.net,
      safeToSpend: safeToSpend.amount,
      overdueBills: overdue.length,
      budgetsOver: budgets.filter((b) => b.health === 'over').length,
      budgetsProjectedOver: budgets.filter((b) => b.health === 'projected_over').length,
      monthsOfExpensesCovered: avgMonthlySpend > 0 ? liquid / avgMonthlySpend : null,
    });

    return { netWorth, month, safeToSpend, budgets, bills, overdue, health };
  }, [transactions, accounts, balances, asOf, safeToSpend, budgets, occurrences]);
}

/** Merchants the user has typed before, for autocomplete and smart defaults. */
export function useMerchants(): string[] {
  const transactions = useStore((s) => s.transactions);
  return React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of live(transactions)) {
      const m = t.merchant?.trim();
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  }, [transactions]);
}

export function useTags(): string[] {
  const transactions = useStore((s) => s.transactions);
  return React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of live(transactions)) {
      for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [transactions]);
}

/**
 * Smart defaults for the quick-add form: the account and category the user most
 * recently used, so a routine expense needs almost no input.
 */
export function useLastUsed() {
  const transactions = useStore((s) => s.transactions);
  const accounts = useAccountMap();

  return React.useMemo(() => {
    const recent = live(transactions)
      .filter((t) => t.kind === 'expense')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!recent) return { accountId: null as ID | null, categoryId: null as ID | null };

    const source = recent.postings.find(
      (p) => p.amount < 0 && !CATEGORY_CLASSES.includes(accounts.get(p.accountId)?.class ?? 'cash'),
    );
    const category = recent.postings.find(
      (p) => accounts.get(p.accountId)?.class === 'expense_category',
    );
    return { accountId: source?.accountId ?? null, categoryId: category?.accountId ?? null };
  }, [transactions, accounts]);
}

/** Merchant → category, learned from history. Powers the quick-add guess. */
export function useMerchantMemory(): Map<string, ID> {
  const transactions = useStore((s) => s.transactions);
  const accounts = useAccountMap();

  return React.useMemo(() => {
    const tally = new Map<string, Map<ID, number>>();
    for (const t of live(transactions)) {
      const key = t.merchant?.trim().toLowerCase();
      if (!key) continue;
      const category = t.postings.find(
        (p) => accounts.get(p.accountId)?.class === 'expense_category',
      )?.accountId;
      if (!category) continue;
      const inner = tally.get(key) ?? new Map<ID, number>();
      inner.set(category, (inner.get(category) ?? 0) + 1);
      tally.set(key, inner);
    }

    const best = new Map<string, ID>();
    for (const [merchant, inner] of tally) {
      const top = [...inner.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) best.set(merchant, top[0]);
    }
    return best;
  }, [transactions, accounts]);
}

export { addDays };
