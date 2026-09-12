import { sequentialIds } from '../core/ids';
import { nowIso } from '../core/dates';
import type { Account, AccountClass, ID } from '../core/types';
import type { LedgerContext } from '../core/ledger';

let counter = 0;

export function makeAccount(
  cls: AccountClass,
  name: string,
  overrides: Partial<Account> = {},
): Account {
  const ts = '2026-01-01T00:00:00.000Z';
  return {
    id: overrides.id ?? `acc_${cls}_${name.toLowerCase().replace(/\W+/g, '_')}_${++counter}`,
    class: cls,
    name,
    parentId: null,
    currency: 'PKR',
    icon: null,
    color: null,
    archived: false,
    archivedAt: null,
    system: false,
    sortOrder: 0,
    notes: null,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

/**
 * A realistic starting ledger: two spendable accounts, a credit card, two
 * people, a goal, the standard system accounts and a handful of categories.
 */
export function makeLedger(opts: { baseCurrency?: string; fxRates?: Record<string, number> } = {}) {
  const a = {
    cash: makeAccount('cash', 'Cash', { id: 'acc_cash' }),
    bank: makeAccount('bank', 'Meezan Bank', { id: 'acc_bank' }),
    savings: makeAccount('savings', 'Savings', { id: 'acc_savings' }),
    card: makeAccount('credit_card', 'HBL Card', { id: 'acc_card', creditLimit: 30000000 }),
    usd: makeAccount('bank', 'Payoneer USD', { id: 'acc_usd', currency: 'USD' }),

    food: makeAccount('expense_category', 'Food', { id: 'cat_food' }),
    groceries: makeAccount('expense_category', 'Groceries', { id: 'cat_groceries' }),
    household: makeAccount('expense_category', 'Household', { id: 'cat_household' }),
    personal: makeAccount('expense_category', 'Personal', { id: 'cat_personal' }),
    transport: makeAccount('expense_category', 'Transport', { id: 'cat_transport' }),

    salary: makeAccount('income_category', 'Salary', { id: 'cat_salary' }),
    freelance: makeAccount('income_category', 'Freelance', { id: 'cat_freelance' }),

    sara: makeAccount('receivable', 'Sara', { id: 'acc_recv_sara', personId: 'per_sara' }),
    bilal: makeAccount('payable', 'Bilal', { id: 'acc_pay_bilal', personId: 'per_bilal' }),

    goal: makeAccount('goal', 'Laptop', { id: 'acc_goal_laptop', goalId: 'gol_laptop' }),

    adjustment: makeAccount('adjustment', 'Adjustments', { id: 'sys_adjustment', system: true }),
    opening: makeAccount('opening_balance', 'Opening balances', { id: 'sys_opening', system: true }),

    archived: makeAccount('cash', 'Old Wallet', { id: 'acc_archived', archived: true }),
  };

  const accounts = new Map<ID, Account>(Object.values(a).map((acc) => [acc.id, acc]));

  const ctx: LedgerContext = {
    accounts,
    baseCurrency: opts.baseCurrency ?? 'PKR',
    fxRates: opts.fxRates ?? { USD: 278.5, EUR: 300 },
    now: () => nowIso(new Date('2026-09-01T10:00:00.000Z')),
    newId: sequentialIds(),
  };

  return { a, accounts, ctx };
}

/** Rupees to paisa, for readable test amounts. */
export const rs = (n: number) => Math.round(n * 100);
