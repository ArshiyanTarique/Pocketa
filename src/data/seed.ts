/**
 * Sensible defaults.
 *
 * Categories are opinionated but entirely editable: every one can be renamed,
 * recoloured, re-parented or archived. Nothing here is load-bearing except the
 * two system accounts, which the ledger needs as counterparties for opening
 * balances and reconciliations.
 */

import { nowIso } from '../core/dates';
import { newId } from '../core/ids';
import type { Account, AccountClass, ID, Settings } from '../core/types';

export const SYSTEM_ADJUSTMENT_ID = 'sys_adjustment';
export const SYSTEM_OPENING_ID = 'sys_opening';

interface CategorySeed {
  name: string;
  icon: string;
  color: string;
  children?: string[];
}

const EXPENSE_CATEGORIES: CategorySeed[] = [
  { name: 'Food & Drink', icon: 'utensils', color: '#F97362', children: ['Groceries', 'Dining out', 'Coffee & snacks'] },
  { name: 'Transport', icon: 'car-front', color: '#4C9AFF', children: ['Fuel', 'Ride-hailing', 'Public transport', 'Parking'] },
  { name: 'Housing', icon: 'house', color: '#8B7CF6', children: ['Rent', 'Utilities', 'Internet', 'Maintenance'] },
  { name: 'Shopping', icon: 'shopping-bag', color: '#F0A23B', children: ['Clothing', 'Electronics', 'Household'] },
  { name: 'Health', icon: 'heart-pulse', color: '#3FBF7F', children: ['Doctor', 'Pharmacy', 'Fitness'] },
  { name: 'Education', icon: 'graduation-cap', color: '#3AB7C4', children: ['Tuition', 'Books', 'Courses'] },
  { name: 'Entertainment', icon: 'clapperboard', color: '#E45FA8', children: ['Subscriptions', 'Events', 'Games'] },
  { name: 'Personal', icon: 'user-round', color: '#B08A5E', children: ['Grooming', 'Gifts'] },
  { name: 'Family', icon: 'users-round', color: '#6E8BD6', children: [] },
  { name: 'Travel', icon: 'plane', color: '#22A8B0', children: ['Flights', 'Stays'] },
  { name: 'Fees & Charges', icon: 'receipt', color: '#94A3B8', children: ['Bank fees', 'Taxes'] },
  { name: 'Other', icon: 'circle-dashed', color: '#8E9AAB', children: [] },
];

const INCOME_CATEGORIES: CategorySeed[] = [
  { name: 'Salary', icon: 'briefcase', color: '#3FBF7F' },
  { name: 'Freelance', icon: 'laptop', color: '#4C9AFF' },
  { name: 'Business', icon: 'store', color: '#8B7CF6' },
  { name: 'Investments', icon: 'trending-up', color: '#F0A23B' },
  { name: 'Gifts received', icon: 'gift', color: '#E45FA8' },
  { name: 'Other income', icon: 'circle-dashed', color: '#8E9AAB' },
];

function account(
  cls: AccountClass,
  name: string,
  currency: string,
  extra: Partial<Account> = {},
): Account {
  const ts = nowIso();
  return {
    id: extra.id ?? newId('acc'),
    class: cls,
    name,
    parentId: null,
    currency,
    icon: null,
    color: null,
    archived: false,
    archivedAt: null,
    system: false,
    sortOrder: 0,
    notes: null,
    createdAt: ts,
    updatedAt: ts,
    ...extra,
  };
}

/** The two accounts the ledger cannot operate without. */
export function systemAccounts(currency: string): Account[] {
  return [
    account('adjustment', 'Adjustments', currency, {
      id: SYSTEM_ADJUSTMENT_ID,
      system: true,
      icon: 'scale',
      color: '#94A3B8',
      notes: 'Holds the difference whenever an account is reconciled to a counted balance.',
    }),
    account('opening_balance', 'Opening balances', currency, {
      id: SYSTEM_OPENING_ID,
      system: true,
      icon: 'flag',
      color: '#94A3B8',
      notes: 'The counterparty for starting balances.',
    }),
  ];
}

export function defaultCategories(currency: string): Account[] {
  const out: Account[] = [];
  let order = 0;

  for (const seed of EXPENSE_CATEGORIES) {
    const parent = account('expense_category', seed.name, currency, {
      icon: seed.icon,
      color: seed.color,
      sortOrder: order++,
    });
    out.push(parent);
    for (const child of seed.children ?? []) {
      out.push(
        account('expense_category', child, currency, {
          parentId: parent.id,
          icon: seed.icon,
          color: seed.color,
          sortOrder: order++,
        }),
      );
    }
  }

  order = 0;
  for (const seed of INCOME_CATEGORIES) {
    out.push(
      account('income_category', seed.name, currency, {
        icon: seed.icon,
        color: seed.color,
        sortOrder: order++,
      }),
    );
  }

  return out;
}

/** A starter cash account so the very first transaction has somewhere to go. */
export function starterAccounts(currency: string): Account[] {
  return [
    account('cash', 'Cash', currency, { icon: 'wallet', color: '#3FBF7F', sortOrder: 0 }),
  ];
}

export function defaultSettings(deviceId: string, currency: string): Settings {
  const ts = nowIso();
  return {
    id: 'settings',
    baseCurrency: currency,
    fxRates: {},
    fxUpdatedAt: null,
    theme: 'system',
    weekStartsOn: 1,
    monthStartDay: 1,
    safeToSpendHorizon: 30,
    safeToSpendReserveGoals: true,
    hideAmounts: false,
    onboarded: false,
    deviceId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export interface SeedResult {
  accounts: Account[];
  settings: Settings;
}

export function buildSeed(deviceId: string, currency = 'PKR'): SeedResult {
  return {
    accounts: [
      ...systemAccounts(currency),
      ...starterAccounts(currency),
      ...defaultCategories(currency),
    ],
    settings: defaultSettings(deviceId, currency),
  };
}

/** Find a category by name, used by the natural-language parser and importer. */
export function findCategoryByName(accounts: readonly Account[], name: string): ID | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const exact = accounts.find(
    (a) =>
      (a.class === 'expense_category' || a.class === 'income_category') &&
      !a.archived &&
      a.name.toLowerCase() === needle,
  );
  if (exact) return exact.id;
  const partial = accounts.find(
    (a) =>
      (a.class === 'expense_category' || a.class === 'income_category') &&
      !a.archived &&
      a.name.toLowerCase().includes(needle),
  );
  return partial?.id ?? null;
}
