/**
 * Sample data.
 *
 * A realistic three months of activity so someone can see what Pocketa does
 * before committing their own numbers to it. Every construct the product
 * supports appears at least once — a split, a shared bill, a refund, a card
 * payment, a debt, a goal contribution, a reconciliation — so this doubles as
 * a working demonstration that the ledger holds together end to end.
 */

import { addDays, addMonths, nowIso, startOfMonth, today, withDayOfMonth, type CalendarDate } from '../core/dates';
import { newId } from '../core/ids';
import type { TxnDraft } from '../core/draft';
import { occurrencesBetween } from '../core/recurrence';
import type { Account, Budget, Goal, OccurrenceOverride, Person, Recurrence } from '../core/types';

const rs = (n: number) => Math.round(n * 100);

export interface DemoData {
  accounts: Account[];
  /** Ids in `accounts` that already existed and are being reused, not created. */
  reusedAccountIds: string[];
  people: Person[];
  budgets: Budget[];
  goals: Goal[];
  recurrences: Recurrence[];
  overrides: OccurrenceOverride[];
  drafts: TxnDraft[];
}

function account(over: Partial<Account> & Pick<Account, 'class' | 'name'>): Account {
  const ts = nowIso();
  return {
    id: over.id ?? newId('acc'),
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
    ...over,
  };
}

/**
 * @param categoryIds ids of the seeded categories, looked up by name.
 */
export function buildDemo(
  findCategory: (name: string) => string | null,
  baseCurrency = 'PKR',
  /** The cash account laid down on first run, reused so there are not two. */
  existingCashId?: string,
): DemoData {
  const asOf = today();
  const thisMonth = startOfMonth(asOf);
  const lastMonth = addMonths(thisMonth, -1);
  const twoMonthsAgo = addMonths(thisMonth, -2);

  // --- accounts ----------------------------------------------------------
  const bank = account({ class: 'bank', name: 'Meezan Bank', institution: 'Meezan', color: '#4C9AFF', icon: 'landmark', sortOrder: 0 });
  const cash = account({ class: 'cash', name: 'Cash', color: '#3FBF7F', icon: 'wallet', sortOrder: 1, id: existingCashId });
  const wallet = account({ class: 'ewallet', name: 'SadaPay', color: '#8B7CF6', icon: 'smartphone', sortOrder: 2 });
  const card = account({ class: 'credit_card', name: 'HBL Platinum', color: '#F0A23B', icon: 'credit-card', creditLimit: rs(250000), statementDay: 25, dueDay: 12, last4: '4417', sortOrder: 3 });
  const savings = account({ class: 'savings', name: 'Savings', color: '#22A8B0', icon: 'piggy-bank', sortOrder: 4 });
  const goalAccount = account({ class: 'goal', name: 'MacBook', color: '#145C55', icon: 'target' });

  const sara = { person: makePerson('Sara'), recv: null as unknown as Account, pay: null as unknown as Account };
  sara.recv = account({ class: 'receivable', name: 'Sara', personId: sara.person.id });
  sara.pay = account({ class: 'payable', name: 'Sara', personId: sara.person.id });

  const bilal = { person: makePerson('Bilal'), recv: null as unknown as Account, pay: null as unknown as Account };
  bilal.recv = account({ class: 'receivable', name: 'Bilal', personId: bilal.person.id });
  bilal.pay = account({ class: 'payable', name: 'Bilal', personId: bilal.person.id });

  const accounts = [bank, cash, wallet, card, savings, goalAccount, sara.recv, sara.pay, bilal.recv, bilal.pay];
  const reusedAccountIds = existingCashId ? [existingCashId] : [];

  // --- category lookups --------------------------------------------------
  const cat = (name: string, fallback: string) => findCategory(name) ?? findCategory(fallback) ?? '';
  const groceries = cat('Groceries', 'Food & Drink');
  const dining = cat('Dining out', 'Food & Drink');
  const coffee = cat('Coffee & snacks', 'Food & Drink');
  const fuel = cat('Fuel', 'Transport');
  const ride = cat('Ride-hailing', 'Transport');
  const rent = cat('Rent', 'Housing');
  const utilities = cat('Utilities', 'Housing');
  const internet = cat('Internet', 'Housing');
  const household = cat('Household', 'Shopping');
  const clothing = cat('Clothing', 'Shopping');
  const electronics = cat('Electronics', 'Shopping');
  const pharmacy = cat('Pharmacy', 'Health');
  const subs = cat('Subscriptions', 'Entertainment');
  const books = cat('Books', 'Education');
  const salary = cat('Salary', 'Salary');
  const freelance = cat('Freelance', 'Freelance');

  const drafts: TxnDraft[] = [];

  // --- opening balances --------------------------------------------------
  const openingDate = addDays(twoMonthsAgo, -1);
  drafts.push(
    { type: 'opening', date: openingDate, accountId: bank.id, amount: rs(184000), openingAccountId: 'sys_opening' },
    { type: 'opening', date: openingDate, accountId: cash.id, amount: rs(12500), openingAccountId: 'sys_opening' },
    { type: 'opening', date: openingDate, accountId: wallet.id, amount: rs(6200), openingAccountId: 'sys_opening' },
    { type: 'opening', date: openingDate, accountId: savings.id, amount: rs(320000), openingAccountId: 'sys_opening' },
    { type: 'opening', date: openingDate, accountId: card.id, amount: rs(-18400), openingAccountId: 'sys_opening' },
  );

  // --- three months of a plausible life ----------------------------------
  const months = [twoMonthsAgo, lastMonth, thisMonth];

  const todayDay = Number(asOf.slice(8, 10));

  months.forEach((month, index) => {
    const isCurrent = index === 2;

    /**
     * In the current month, a date later than today would be a transaction that
     * has not happened yet. Rather than dropping those rows — which leaves the
     * dashboard looking empty in the first days of a month — the month's rhythm
     * is compressed into the days that have actually elapsed.
     */
    const day = (n: number) => withDayOfMonth(month, isCurrent ? Math.min(n, todayDay) : n);

    // Salary
    drafts.push({
      type: 'earn',
      date: day(1),
      accountId: bank.id,
      merchant: 'Salesflo',
      allocations: [{ categoryId: salary, amount: rs(285000) }],
    });

    // Freelance income, but not every month
    if (index !== 1) {
      drafts.push({
        type: 'earn',
        date: day(18),
        accountId: wallet.id,
        merchant: 'Upwork',
        tags: ['Work'],
        allocations: [{ categoryId: freelance, amount: rs(42000 + index * 6500) }],
      });
    }

    // The fixed monthly bills
    drafts.push({
      type: 'spend',
      date: day(3),
      accountId: bank.id,
      merchant: 'Landlord',
      allocations: [{ categoryId: rent, amount: rs(85000) }],
    });
    drafts.push({
      type: 'spend',
      date: day(9),
      accountId: bank.id,
      merchant: 'K-Electric',
      // One month runs hot, so a bill differs from its template.
      allocations: [{ categoryId: utilities, amount: rs(index === 1 ? 14800 : 11200) }],
    });
    drafts.push({
      type: 'spend',
      date: day(11),
      accountId: bank.id,
      merchant: 'StormFiber',
      allocations: [{ categoryId: internet, amount: rs(4500) }],
    });

    // The weekly rhythm of small spending
    const smalls: Array<[number, string, number, string, string]> = [
      [4, 'OPTP', 850, dining, cash.id],
      [6, 'Imtiaz', 9400, groceries, card.id],
      [7, 'Careem', 620, ride, wallet.id],
      [8, 'Chai Wala', 320, coffee, cash.id],
      [12, 'Shell', 6800, fuel, card.id],
      [14, 'Imtiaz', 7250, groceries, card.id],
      [15, 'Kababjees', 3400, dining, card.id],
      [17, 'Careem', 940, ride, wallet.id],
      [19, 'Servaid', 2150, pharmacy, cash.id],
      [21, 'Imtiaz', 8100, groceries, card.id],
      [22, 'Netflix', 1750, subs, card.id],
      [24, 'Shell', 7200, fuel, card.id],
      [26, 'Liberty Books', 3600, books, wallet.id],
      [27, 'Chai Wala', 280, coffee, cash.id],
    ];

    for (const [d, merchant, amount, categoryId, accountId] of smalls) {
      if (!categoryId) continue;
      drafts.push({
        type: 'spend',
        date: day(d),
        accountId,
        merchant,
        allocations: [{ categoryId, amount: rs(amount) }],
      });
    }

    // A split at the supermarket — the worked example from the brief
    drafts.push({
      type: 'spend',
      date: day(20),
      accountId: card.id,
      merchant: 'Imtiaz',
      notes: 'Monthly stock-up',
      allocations: [
        { categoryId: groceries, amount: rs(3000) },
        { categoryId: household, amount: rs(1200) },
        { categoryId: cat('Personal', 'Personal') || household, amount: rs(800) },
      ],
    });

    // Paying the card bill — a transfer, never an expense
    drafts.push({
      type: 'move',
      kind: 'cc_payment',
      date: day(12),
      fromAccountId: bank.id,
      toAccountId: card.id,
      amount: rs(index === 0 ? 18400 : 32000),
    });

    // Cash top-up
    drafts.push({
      type: 'move',
      kind: 'transfer',
      date: day(5),
      fromAccountId: bank.id,
      toAccountId: cash.id,
      amount: rs(20000),
    });

    // Goal contribution — set aside, not spent
    drafts.push({
      type: 'move',
      kind: 'goal_contribution',
      date: day(2),
      fromAccountId: bank.id,
      toAccountId: goalAccount.id,
      amount: rs(25000),
      merchant: 'MacBook',
    });
  });

  // --- one-off events that exercise the trickier rules -------------------

  // Dinner split three ways: only a third is really my expense
  drafts.push({
    type: 'spend',
    date: withDayOfMonth(lastMonth, 16),
    accountId: card.id,
    merchant: 'Kolachi',
    notes: 'Dinner with Sara and Bilal',
    tags: ['Family'],
    allocations: [{ categoryId: dining, amount: rs(4200) }],
    shares: [
    { personAccountId: sara.recv.id, amount: rs(4200) },
    { personAccountId: bilal.recv.id, amount: rs(4200) },
    ],
  });

  // Sara settles up — not income
  drafts.push({
    type: 'move', kind: 'repay_in',
    date: withDayOfMonth(lastMonth, 24),
    fromAccountId: sara.recv.id, toAccountId: cash.id, amount: rs(4200),
    merchant: 'Sara',
  });

  // Borrowed from Bilal, partly repaid — neither is income or expense
  drafts.push({
    type: 'move', kind: 'borrow',
    date: withDayOfMonth(twoMonthsAgo, 22),
    fromAccountId: bilal.pay.id, toAccountId: cash.id, amount: rs(15000),
    merchant: 'Bilal', notes: 'Short-term, no rush',
  });
  drafts.push({
    type: 'move', kind: 'repay_out',
    date: withDayOfMonth(lastMonth, 8),
    fromAccountId: bank.id, toAccountId: bilal.pay.id, amount: rs(5000),
    merchant: 'Bilal',
  });

  // A jacket bought then partly returned — the refund links to the original
  const jacketDate = withDayOfMonth(lastMonth, 13);
  drafts.push({
    type: 'spend', date: jacketDate, accountId: card.id, merchant: 'Outfitters',
    allocations: [{ categoryId: clothing || household, amount: rs(8900) }],
  });

  // A cash reconciliation: counted less than the ledger said
  drafts.push({
    type: 'adjust',
    date: withDayOfMonth(lastMonth, 28),
    accountId: cash.id,
    delta: rs(-450),
    adjustmentAccountId: 'sys_adjustment',
    notes: 'Counted the wallet',
  });

  // A larger purchase on the wallet
  drafts.push({
    type: 'spend',
    date: withDayOfMonth(twoMonthsAgo, 15),
    accountId: wallet.id,
    merchant: 'Daraz',
    tags: ['Work'],
    allocations: [{ categoryId: electronics || household, amount: rs(12400) }],
  });

  // --- budgets -----------------------------------------------------------
  const budgets: Budget[] = [
    makeBudget('Groceries', [groceries], rs(35000)),
    makeBudget('Eating out', [dining, coffee].filter(Boolean), rs(12000)),
    makeBudget('Transport', [fuel, ride].filter(Boolean), rs(18000)),
    makeBudget('Everything', [], rs(200000), 0.9),
  ];

  // --- goals -------------------------------------------------------------
  const goals: Goal[] = [
    {
    id: newId('gol'),
    name: 'MacBook',
    targetAmount: rs(450000),
    targetDate: addMonths(asOf, 7),
    accountId: goalAccount.id,
    currency: baseCurrency,
    icon: null,
    color: '#145C55',
    notes: 'M-series, 16GB',
    plannedContribution: rs(25000),
    plannedFrequency: 'monthly',
    archived: false,
    completedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    },
  ];

  // --- recurring bills ---------------------------------------------------
  const recurrences: Recurrence[] = [
    makeRecurrence('Rent', rs(85000), bank.id, rent, 3, addMonths(thisMonth, -2)),
    makeRecurrence('Electricity', rs(11200), bank.id, utilities, 9, addMonths(thisMonth, -2)),
    makeRecurrence('Internet', rs(4500), bank.id, internet, 11, addMonths(thisMonth, -2)),
    makeRecurrence('Netflix', rs(1750), card.id, subs, 22, addMonths(thisMonth, -2)),
  ];

  /**
   * The demo already records each month's rent, electricity, internet and
   * Netflix as real transactions, so the matching scheduled occurrences are
   * marked paid. Without this every past date would correctly surface as
   * overdue (business rule R9) and bury the useful signal.
   *
   * One occurrence is deliberately left unpaid so the overdue state, and the
   * way Safe-to-Spend reserves against it, are both visible.
   */
  const overrides: OccurrenceOverride[] = [];
  const leaveUnpaid = recurrences.find((r) => r.name === 'Electricity');
  for (const rec of recurrences) {
    const due = occurrencesBetween(rec, { from: rec.startDate, to: asOf });
    const lastIndex = due.length - 1;
    due.forEach((dueDate, i) => {
    const leaveThisOne = rec.id === leaveUnpaid?.id && i === lastIndex;
    if (leaveThisOne) return;
    overrides.push({
      id: newId('ovr'),
      recurrenceId: rec.id,
      dueDate,
      status: 'paid',
      amount: null,
      paidDate: dueDate,
      txnId: null,
      notes: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    });
  }

  return {
    accounts,
    reusedAccountIds,
    people: [sara.person, bilal.person],
    budgets,
    goals,
    recurrences,
    overrides,
    drafts,
  };
}

function makePerson(name: string): Person {
  return {
    id: newId('per'),
    name,
    contact: null,
    notes: null,
    color: null,
    archived: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function makeBudget(name: string, categoryIds: string[], limit: number, warnAt = 0.8): Budget {
  return {
    id: newId('bud'),
    name,
    categoryIds: categoryIds.filter(Boolean),
    limit,
    period: 'monthly',
    customFrom: null,
    customTo: null,
    startDay: 1,
    rollover: false,
    warnAt,
    archived: false,
    color: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function makeRecurrence(
  name: string,
  amount: number,
  accountId: string,
  categoryId: string,
  dayOfMonth: number,
  startDate: CalendarDate,
): Recurrence {
  return {
    id: newId('rec'),
    name,
    kind: 'expense',
    amount,
    currency: 'PKR',
    accountId,
    categoryId,
    toAccountId: null,
    merchant: name,
    notes: null,
    tags: [],
    frequency: 'monthly',
    interval: 1,
    byWeekday: null,
    byMonthDay: dayOfMonth,
    startDate: withDayOfMonth(startDate, dayOfMonth),
    endDate: null,
    maxOccurrences: null,
    leadDays: 7,
    autoPost: false,
    archived: false,
    isBill: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

/** Refund built after the fact, since it must link to a saved transaction. */
export function buildDemoRefund(
  originalTxnId: string,
  cardAccountId: string,
  categoryId: string,
  date: CalendarDate,
): TxnDraft {
  return {
    type: 'refund',
    date,
    originalTxnId,
    toAccountId: cardAccountId,
    allocations: [{ categoryId, amount: Math.round(8900 * 100 * 0.45) }],
    merchant: 'Outfitters',
    notes: 'Returned the jacket, kept the shirt',
  };
}
