import type { CalendarDate } from './dates';

export type ID = string;
export type ISOTimestamp = string;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * Everything a posting can point at is a ledger account, including categories.
 * The class determines how a balance rolls up. The UI shows `expense_category`
 * and `income_category` as "Categories" and never uses the word "account" for
 * them — but the ledger treats them uniformly, which is what makes the
 * zero-sum invariant possible.
 */
export type AccountClass =
  // assets
  | 'cash'
  | 'bank'
  | 'savings'
  | 'ewallet'
  | 'investment'
  // liabilities
  | 'credit_card'
  | 'loan'
  // people
  | 'receivable' // money others owe me — an asset
  | 'payable' // money I owe others — a liability
  // earmarked
  | 'goal'
  // categories
  | 'expense_category'
  | 'income_category'
  // system
  | 'adjustment'
  | 'opening_balance';

export const ASSET_CLASSES: readonly AccountClass[] = [
  'cash', 'bank', 'savings', 'ewallet', 'investment', 'receivable', 'goal',
];
export const LIABILITY_CLASSES: readonly AccountClass[] = ['credit_card', 'loan', 'payable'];
export const CATEGORY_CLASSES: readonly AccountClass[] = ['expense_category', 'income_category'];
export const SYSTEM_CLASSES: readonly AccountClass[] = ['adjustment', 'opening_balance'];

/** Accounts a user can spend from or into — the ones shown in an account picker. */
export const SPENDABLE_CLASSES: readonly AccountClass[] = [
  'cash', 'bank', 'savings', 'ewallet', 'investment', 'credit_card', 'loan',
];

/** Liquid accounts, used for Safe-to-Spend. Excludes investments, goals, credit. */
export const LIQUID_CLASSES: readonly AccountClass[] = ['cash', 'bank', 'ewallet'];

export function isAsset(c: AccountClass): boolean {
  return ASSET_CLASSES.includes(c);
}
export function isLiability(c: AccountClass): boolean {
  return LIABILITY_CLASSES.includes(c);
}
export function isCategory(c: AccountClass): boolean {
  return CATEGORY_CLASSES.includes(c);
}
export function isSystem(c: AccountClass): boolean {
  return SYSTEM_CLASSES.includes(c);
}
/** Contributes to net worth. Categories and system accounts do not. */
export function affectsNetWorth(c: AccountClass): boolean {
  return isAsset(c) || isLiability(c);
}

export interface Account {
  id: ID;
  class: AccountClass;
  name: string;
  /** Parent category, for subcategories. Null for top-level and non-categories. */
  parentId: ID | null;
  currency: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
  archivedAt: ISOTimestamp | null;
  /** System accounts cannot be deleted or archived by the user. */
  system: boolean;
  sortOrder: number;
  notes: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;

  // Class-specific, all optional
  institution?: string | null;
  last4?: string | null;
  /** Credit cards: limit in minor units. */
  creditLimit?: number | null;
  /** Credit cards: day of month the statement closes. */
  statementDay?: number | null;
  /** Credit cards and loans: day of month payment is due. */
  dueDay?: number | null;
  /** Receivable/payable: the person this tracks. */
  personId?: ID | null;
  /** Goal accounts: the goal this funds. */
  goalId?: ID | null;
  /** Investments: exclude from Safe-to-Spend by default. */
  excludeFromNetWorth?: boolean;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface Person {
  id: ID;
  name: string;
  /** Free-form: phone, email, or nothing at all. */
  contact: string | null;
  notes: string | null;
  color: string | null;
  archived: boolean;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * The header label. Purely for UI language and reporting filters — it carries
 * NO correctness weight. Whether something counts as an expense is determined
 * by whether a posting touches an expense category, never by this field.
 */
export type TxnKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'cc_payment'
  | 'refund'
  | 'lend' // I gave money to someone; they now owe me
  | 'borrow' // Someone gave me money; I now owe them
  | 'repay_out' // I paid back money I owed
  | 'repay_in' // Someone paid back money they owed me
  | 'goal_contribution'
  | 'goal_withdrawal'
  | 'adjustment'
  | 'opening'
  | 'carpool_settlement';

export const TXN_KIND_LABELS: Record<TxnKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  cc_payment: 'Card payment',
  refund: 'Refund',
  lend: 'Lent',
  borrow: 'Borrowed',
  repay_out: 'Debt repaid',
  repay_in: 'Debt collected',
  goal_contribution: 'To goal',
  goal_withdrawal: 'From goal',
  adjustment: 'Adjustment',
  opening: 'Opening balance',
  carpool_settlement: 'Carpool',
};

/** Kinds that move money between accounts without touching any category. */
export const MOVEMENT_KINDS: readonly TxnKind[] = [
  'transfer', 'cc_payment', 'lend', 'borrow', 'repay_out', 'repay_in',
  'goal_contribution', 'goal_withdrawal',
];

export interface Posting {
  id: ID;
  accountId: ID;
  /** Signed, in minor units of `currency`. Negative leaves the account. */
  amount: number;
  currency: string;
  /** Signed, in minor units of the ledger base currency. Frozen at entry. */
  baseAmount: number;
  /** 1 unit of `currency` = `fxRate` units of base currency. Frozen at entry. */
  fxRate: number;
  memo: string | null;
}

export interface Transaction {
  id: ID;
  kind: TxnKind;
  /** The calendar day the money moved. Timezone-naive by design. */
  date: CalendarDate;
  /** Optional wall-clock time 'HH:mm', for ordering within a day. */
  time: string | null;
  postings: Posting[];

  merchant: string | null;
  notes: string | null;
  tags: string[];
  attachmentIds: ID[];

  /** Refunds point at the transaction they refund. */
  linkedTxnId: ID | null;
  /** Set when materialised from a recurrence template. */
  recurrenceId: ID | null;
  /** Stable key for one occurrence, e.g. 'rec_123:2026-09-01'. */
  occurrenceKey: string | null;
  /** Set when created by an import, so a batch can be reviewed or undone. */
  importBatchId: ID | null;
  /** Fuzzy hash used for duplicate detection. */
  dedupeHash: string | null;

  /** Soft delete. The row is retained for audit and can be restored. */
  voided: boolean;
  voidedAt: ISOTimestamp | null;

  currency: string;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export type BudgetPeriod = 'monthly' | 'weekly' | 'yearly' | 'custom';

export interface Budget {
  id: ID;
  name: string;
  /** Category accounts this budget covers. Empty means all expense categories. */
  categoryIds: ID[];
  /** Limit in minor units of the base currency. */
  limit: number;
  period: BudgetPeriod;
  /** For 'custom' periods. */
  customFrom: CalendarDate | null;
  customTo: CalendarDate | null;
  /** Day the monthly period starts, for salary-aligned budgets. Default 1. */
  startDay: number;
  /**
   * What happens to unspent budget at period end.
   * - 'restart'  — period resets with the original limit (default)
   * - 'carry'    — leftover is added to next period's limit
   * - 'transfer' — leftover is transferred into rolloverAccountId
   */
  rolloverMode: 'restart' | 'carry' | 'transfer';
  /** Account to transfer surplus into when rolloverMode === 'transfer'. */
  rolloverAccountId: ID | null;
  /** @deprecated use rolloverMode === 'carry' instead. Kept for migration. */
  rollover: boolean;
  /** Warn at this fraction of the limit. Default 0.8. */
  warnAt: number;
  archived: boolean;
  color: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Recurrences (bills, subscriptions, recurring income)
// ---------------------------------------------------------------------------

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom_days';

export type OccurrenceStatus = 'upcoming' | 'due' | 'overdue' | 'paid' | 'skipped';

export interface Recurrence {
  id: ID;
  name: string;
  kind: Extract<TxnKind, 'expense' | 'income' | 'transfer'>;
  /** Template amount in minor units. A single occurrence may override this
   *  WITHOUT mutating the template (business rule R8). */
  amount: number;
  currency: string;
  accountId: ID;
  categoryId: ID | null;
  /** For transfer recurrences. */
  toAccountId: ID | null;
  merchant: string | null;
  notes: string | null;
  tags: string[];

  frequency: RecurrenceFrequency;
  /** Every N periods. 1 = every month, 2 = every other month. */
  interval: number;
  /** For weekly: 0-6. For monthly: day of month (clamped). For yearly: unused. */
  byWeekday: number | null;
  byMonthDay: number | null;
  startDate: CalendarDate;
  endDate: CalendarDate | null;
  /** Stop after N occurrences. */
  maxOccurrences: number | null;
  /** Days before the due date to surface it as upcoming. */
  leadDays: number;
  /** Auto-create the transaction on the due date, or wait for confirmation. */
  autoPost: boolean;
  archived: boolean;
  isBill: boolean;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

/**
 * A per-occurrence override. Its existence is exactly what keeps a changed
 * amount for one month from corrupting the template (R8).
 */
export interface OccurrenceOverride {
  id: ID;
  recurrenceId: ID;
  /** The scheduled date this override applies to. */
  dueDate: CalendarDate;
  status: OccurrenceStatus;
  /** Overridden amount for this occurrence only. */
  amount: number | null;
  /** Actual date paid, if different from due date. */
  paidDate: CalendarDate | null;
  /** The transaction created when this occurrence was paid. */
  txnId: ID | null;
  notes: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface Goal {
  id: ID;
  name: string;
  targetAmount: number;
  targetDate: CalendarDate | null;
  /** The `goal` class account holding contributions. */
  accountId: ID;
  currency: string;
  icon: string | null;
  color: string | null;
  notes: string | null;
  /** Planned periodic contribution, reserved by Safe-to-Spend. */
  plannedContribution: number | null;
  plannedFrequency: 'weekly' | 'monthly' | null;
  archived: boolean;
  completedAt: ISOTimestamp | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Debts
// ---------------------------------------------------------------------------

export type DebtDirection = 'owed_to_me' | 'i_owe';

export interface Debt {
  id: ID;
  direction: DebtDirection;
  personId: ID;
  /** The receivable/payable account carrying the running balance. */
  accountId: ID;
  name: string;
  /** The amount originally lent or borrowed, in minor units. */
  principal: number;
  currency: string;
  dueDate: CalendarDate | null;
  notes: string | null;
  settled: boolean;
  settledAt: ISOTimestamp | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface Attachment {
  id: ID;
  txnId: ID | null;
  name: string;
  mimeType: string;
  size: number;
  /** Stored as a Blob in IndexedDB. */
  blob: Blob | null;
  /** Small data-URL preview for lists. */
  thumbnail: string | null;
  createdAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  id: 'settings';
  baseCurrency: string;
  /** Rates relative to base: 1 unit of KEY = value units of base. */
  fxRates: Record<string, number>;
  fxUpdatedAt: ISOTimestamp | null;
  theme: 'light' | 'dark' | 'system';
  accentColor: 'gold' | 'blue' | 'green' | 'red' | 'purple' | 'slate';
  /** Custom avatar — overrides the Google profile photo when set. */
  avatarUrl: string | null;
  weekStartsOn: 0 | 1;
  /** Day of month the financial month starts, for salary-aligned budgeting. */
  monthStartDay: number;
  /** Safe-to-Spend horizon in days. */
  safeToSpendHorizon: number;
  /** Reserve upcoming goal contributions in Safe-to-Spend. */
  safeToSpendReserveGoals: boolean;
  hideAmounts: boolean;
  onboarded: boolean;
  deviceId: string;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Import batches
// ---------------------------------------------------------------------------

export interface ImportBatch {
  id: ID;
  source: string;
  fileName: string;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  accountId: ID | null;
  createdAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Carpool
// ---------------------------------------------------------------------------

/**
 * A carpool is a tally, not a ledger.
 *
 * Logging that someone rode with you moves no money — it records an obligation
 * that has not yet been billed. Money enters the ledger only at settlement,
 * when the accumulated trips become a receivable against that person. That is
 * why trips live in their own tables rather than as transactions: recording a
 * ride as income the moment it happens would inflate every monthly figure with
 * money you have not been given.
 */
export interface Carpool {
  id: ID;
  name: string;
  /** Default charge per rider per trip, in minor units. */
  ratePerTrip: number;
  currency: string;
  /**
   * How collected money is recorded when a period is billed.
   * `recovery` reduces an expense category — the honest reading, since the
   * money is reimbursing fuel you already paid for.
   * `income` records it as earnings instead.
   */
  settleAs: 'recovery' | 'income';
  /** The expense or income category settlements post against. */
  settleCategoryId: ID | null;
  notes: string | null;
  archived: boolean;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface CarpoolRider {
  id: ID;
  carpoolId: ID;
  personId: ID;
  /** Overrides the carpool rate for this rider when set. */
  ratePerTrip: number | null;
  active: boolean;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface CarpoolTrip {
  id: ID;
  carpoolId: ID;
  date: CalendarDate;
  /** Riders who were on this trip. */
  riderIds: ID[];
  /**
   * The rate in force when the trip was logged, frozen per rider.
   *
   * Raising the rate in October must not silently re-price September, for the
   * same reason an exchange rate is frozen onto a transaction.
   */
  rates: Record<ID, number>;
  note: string | null;
  /** Set once billed, so a trip can never be charged twice. */
  settlementId: ID | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface CarpoolSettlementLine {
  riderId: ID;
  personId: ID;
  personName: string;
  trips: number;
  amount: number;
  /** The receivable transaction created for this rider. */
  txnId: ID | null;
}

export interface CarpoolSettlement {
  id: ID;
  carpoolId: ID;
  from: CalendarDate;
  to: CalendarDate;
  lines: CarpoolSettlementLine[];
  total: number;
  tripCount: number;
  createdAt: ISOTimestamp;
}
