/**
 * The ledger engine.
 *
 * THE ONE INVARIANT: a transaction's postings sum to exactly zero — in the
 * original currency and in the base currency, independently.
 *
 * Everything the product promises about correctness falls out of that:
 *
 *   - Transfers are not expenses          — they post to no category account
 *   - Card payments are not expenses      — likewise; they are transfers
 *   - Debt movements are not income       — they move value between asset forms
 *   - Goal contributions are not expenses — likewise
 *   - Splits total exactly the parent     — enforced by the sum, not by a check
 *   - Balances never drift                — they are summed, never stored
 *
 * None of those is implemented as a special case. They are consequences.
 *
 * The UI never constructs postings by hand. It calls a builder here, and the
 * builder is the only place that knows the posting shape of each scenario.
 */

import {
  assertMinor,
  isSafeMinor,
  convertMinor,
  allocate,
  sumMinor,
  MoneyError,
} from './money';
import { isValidDate, nowIso, type CalendarDate } from './dates';
import { newId as defaultNewId, type IdPrefix } from './ids';
import {
  isCategory,
  MOVEMENT_KINDS,
  type Account,
  type ID,
  type ISOTimestamp,
  type Posting,
  type Transaction,
  type TxnKind,
} from './types';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface Issue {
  code: string;
  message: string;
  field?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

const fail = (code: string, message: string, field?: string): Result<never> => ({
  ok: false,
  issues: [{ code, message, field }],
});

const succeed = <T>(value: T): Result<T> => ({ ok: true, value });

/**
 * Guard every user-supplied amount BEFORE any arithmetic touches it.
 *
 * The money layer throws on a bad value, which is right for a programming error
 * but wrong for user input — a stray "10.5" typed into a split must come back as
 * a readable message, not a crash. So the builders screen inputs first and only
 * then hand them to the arithmetic.
 */
type Failure = { ok: false; issues: Issue[] };

function checkAmounts(values: readonly number[], field: string): Failure | null {
  for (const v of values) {
    if (!isSafeMinor(v)) {
      return { ok: false, issues: [{ code: 'bad_amount', message: 'That amount is not a valid number.', field }] };
    }
  }
  return null;
}

export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`ledger: ${r.issues.map((i) => i.message).join('; ')}`);
  return r.value;
}

// ---------------------------------------------------------------------------
// Build context
// ---------------------------------------------------------------------------

export interface LedgerContext {
  accounts: ReadonlyMap<ID, Account>;
  baseCurrency: string;
  /** 1 unit of KEY = value units of baseCurrency. */
  fxRates: Readonly<Record<string, number>>;
  now?: () => ISOTimestamp;
  newId?: (p: IdPrefix) => ID;
  /** Permit postings to archived accounts. True for imports and restores. */
  allowArchived?: boolean;
}

function ctxNow(ctx: LedgerContext): ISOTimestamp {
  return (ctx.now ?? nowIso)();
}
function ctxId(ctx: LedgerContext, p: IdPrefix): ID {
  return (ctx.newId ?? defaultNewId)(p);
}

export function rateFor(currency: string, ctx: LedgerContext): number | null {
  if (currency === ctx.baseCurrency) return 1;
  const r = ctx.fxRates[currency];
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : null;
}

// ---------------------------------------------------------------------------
// Posting construction
// ---------------------------------------------------------------------------

interface DraftPosting {
  accountId: ID;
  amount: number;
  currency: string;
  memo?: string | null;
}

/**
 * Assign base-currency amounts so that they sum to EXACTLY zero.
 *
 * Converting each posting independently would let rounding break the invariant:
 * $10.00 split three ways and converted at 278.50 gives three values that do not
 * necessarily re-add to Rs. 2,785.00. So instead the total value that LEAVES the
 * transaction is converted once, and that exact base total is then allocated
 * across the receiving postings by weight. Rounding dust is distributed, never
 * created.
 */
function assignBaseAmounts(
  drafts: DraftPosting[],
  ctx: LedgerContext,
): Result<Array<DraftPosting & { baseAmount: number; fxRate: number }>> {
  const base = ctx.baseCurrency;

  for (const d of drafts) {
    if (rateFor(d.currency, ctx) === null) {
      return fail(
        'no_fx_rate',
        `No exchange rate available for ${d.currency}. Add one in Settings before recording this.`,
        'currency',
      );
    }
  }

  const negatives = drafts.filter((d) => d.amount < 0);
  const positives = drafts.filter((d) => d.amount > 0);
  const zeros = drafts.filter((d) => d.amount === 0);

  // Total value leaving, converted to base once per source currency.
  let baseOut = 0;
  const negBase: number[] = [];
  for (const d of negatives) {
    const rate = rateFor(d.currency, ctx)!;
    const b = d.currency === base ? d.amount : -convertMinor(-d.amount, d.currency, base, rate);
    negBase.push(b);
    baseOut += b;
  }

  // Distribute the exact same magnitude across the receiving side.
  const inflowTotal = -baseOut; // positive
  let posBase: number[];
  if (positives.length === 0) {
    posBase = [];
  } else if (positives.every((d) => d.currency === base)) {
    // Same-currency case: use the postings' own amounts as weights so the split
    // is exact rather than merely proportional.
    posBase = allocate(inflowTotal, positives.map((d) => d.amount));
  } else {
    const weights = positives.map((d) => {
      const rate = rateFor(d.currency, ctx)!;
      return d.currency === base ? d.amount : convertMinor(d.amount, d.currency, base, rate);
    });
    posBase = allocate(inflowTotal, weights);
  }

  const out: Array<DraftPosting & { baseAmount: number; fxRate: number }> = [];
  let ni = 0;
  let pi = 0;
  for (const d of drafts) {
    const rate = rateFor(d.currency, ctx)!;
    let baseAmount: number;
    if (d.amount < 0) baseAmount = negBase[ni++];
    else if (d.amount > 0) baseAmount = posBase[pi++];
    else baseAmount = 0;
    out.push({ ...d, baseAmount, fxRate: rate });
  }
  void zeros;
  return succeed(out);
}

function materialisePostings(
  drafts: DraftPosting[],
  ctx: LedgerContext,
): Result<Posting[]> {
  for (const d of drafts) {
    if (!isSafeMinor(d.amount)) {
      return fail('bad_amount', 'That amount is not a valid number.', 'amount');
    }
  }
  const based = assignBaseAmounts(drafts, ctx);
  if (!based.ok) return based;
  return succeed(
    based.value.map((d) => ({
      id: ctxId(ctx, 'pst'),
      accountId: d.accountId,
      amount: d.amount,
      currency: d.currency,
      baseAmount: d.baseAmount,
      fxRate: d.fxRate,
      memo: d.memo ?? null,
    })),
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /** Skip the archived-account check, for restores and historical imports. */
  allowArchived?: boolean;
}

/**
 * The gate every transaction passes through before it reaches the log.
 * Nothing writes a transaction without a passing result here.
 */
export function validateTransaction(
  txn: Transaction,
  ctx: LedgerContext,
  opts: ValidateOptions = {},
): Result<Transaction> {
  const issues: Issue[] = [];
  const allowArchived = opts.allowArchived ?? ctx.allowArchived ?? false;

  if (!isValidDate(txn.date)) {
    issues.push({ code: 'bad_date', message: 'Pick a valid date.', field: 'date' });
  }

  if (!Array.isArray(txn.postings) || txn.postings.length < 2) {
    issues.push({
      code: 'too_few_postings',
      message: 'A transaction must move money between at least two accounts.',
      field: 'postings',
    });
    return { ok: false, issues };
  }

  for (const p of txn.postings) {
    if (!isSafeMinor(p.amount) || !isSafeMinor(p.baseAmount)) {
      issues.push({ code: 'bad_amount', message: 'That amount is not a valid number.', field: 'amount' });
    }
    if (!Number.isFinite(p.fxRate) || p.fxRate <= 0) {
      issues.push({ code: 'bad_fx', message: 'Exchange rate must be greater than zero.', field: 'fxRate' });
    }
    const acc = ctx.accounts.get(p.accountId);
    if (!acc) {
      issues.push({
        code: 'unknown_account',
        message: 'This transaction refers to an account that no longer exists.',
        field: 'accountId',
      });
    } else if (acc.archived && !allowArchived) {
      issues.push({
        code: 'archived_account',
        message: `"${acc.name}" is archived. Unarchive it to record new activity.`,
        field: 'accountId',
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  // --- THE INVARIANT ---
  const baseSum = sumMinor(txn.postings.map((p) => p.baseAmount));
  if (baseSum !== 0) {
    issues.push({
      code: 'unbalanced_base',
      message: `This transaction does not balance — it is off by ${baseSum} in base currency. Money cannot appear or vanish.`,
      field: 'postings',
    });
  }

  const currencies = new Set(txn.postings.map((p) => p.currency));
  if (currencies.size === 1) {
    const sum = sumMinor(txn.postings.map((p) => p.amount));
    if (sum !== 0) {
      issues.push({
        code: 'unbalanced',
        message: `This transaction does not balance — it is off by ${sum}. Splits must total the full amount.`,
        field: 'postings',
      });
    }
  }

  // Zero-value transactions record nothing and clutter history.
  const magnitude = sumMinor(txn.postings.filter((p) => p.amount > 0).map((p) => p.amount));
  if (magnitude === 0) {
    issues.push({
      code: 'zero_amount',
      message: 'Enter an amount greater than zero.',
      field: 'amount',
    });
  }

  // A movement that starts and ends in the same account is a no-op.
  const touched = new Set(txn.postings.map((p) => p.accountId));
  if (touched.size < 2) {
    issues.push({
      code: 'same_account',
      message: 'Choose two different accounts — money cannot move to where it already is.',
      field: 'accountId',
    });
  }

  // Defence in depth: a movement must never touch a category, so it can never
  // be counted as income or expense by any downstream reader.
  if (MOVEMENT_KINDS.includes(txn.kind)) {
    const cat = txn.postings.find((p) => {
      const a = ctx.accounts.get(p.accountId);
      return a && isCategory(a.class);
    });
    if (cat) {
      issues.push({
        code: 'movement_touches_category',
        message: 'A transfer cannot be assigned to a spending category.',
        field: 'categoryId',
      });
    }
  }

  return issues.length > 0 ? { ok: false, issues } : succeed(txn);
}

// ---------------------------------------------------------------------------
// Shared transaction shell
// ---------------------------------------------------------------------------

export interface CommonTxnFields {
  date: CalendarDate;
  time?: string | null;
  merchant?: string | null;
  notes?: string | null;
  tags?: string[];
  attachmentIds?: ID[];
  recurrenceId?: ID | null;
  occurrenceKey?: string | null;
  importBatchId?: ID | null;
  dedupeHash?: string | null;
  /** Supply to rebuild an existing transaction rather than mint a new id. */
  id?: ID;
  createdAt?: ISOTimestamp;
}

function shell(
  kind: TxnKind,
  common: CommonTxnFields,
  postings: Posting[],
  currency: string,
  ctx: LedgerContext,
  linkedTxnId: ID | null = null,
): Transaction {
  const ts = ctxNow(ctx);
  return {
    id: common.id ?? ctxId(ctx, 'txn'),
    kind,
    date: common.date,
    time: common.time ?? null,
    postings,
    merchant: common.merchant?.trim() || null,
    notes: common.notes?.trim() || null,
    tags: normaliseTags(common.tags ?? []),
    attachmentIds: common.attachmentIds ?? [],
    linkedTxnId,
    recurrenceId: common.recurrenceId ?? null,
    occurrenceKey: common.occurrenceKey ?? null,
    importBatchId: common.importBatchId ?? null,
    dedupeHash: common.dedupeHash ?? null,
    voided: false,
    voidedAt: null,
    currency,
    createdAt: common.createdAt ?? ts,
    updatedAt: ts,
  };
}

export function normaliseTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().replace(/^#+/, '').replace(/\s+/g, '-');
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Builder 1 — SPEND (expense, split, shared)
// ---------------------------------------------------------------------------

export interface Allocation {
  categoryId: ID;
  amount: number;
  memo?: string | null;
}

export interface Share {
  /** The receivable account for the person who owes this portion. */
  personAccountId: ID;
  amount: number;
  memo?: string | null;
}

export interface SpendInput extends CommonTxnFields {
  /** The account the money left: cash, bank, e-wallet, or a credit card. */
  accountId: ID;
  /** One entry for a simple expense, several for a split. Must be non-empty. */
  allocations: Allocation[];
  /**
   * Portions other people owe you. These become receivable postings, NOT
   * expense postings — which is what stops a shared bill from inflating your
   * own spending.
   */
  shares?: Share[];
  currency?: string;
}

/**
 * Build an expense.
 *
 * One builder covers the simple case, the split case and the shared case,
 * because they differ only in how many postings sit on the receiving side.
 *
 *   simple:  Cash −850          Food +850
 *   split:   Cash −5000         Groceries +3000  Household +1200  Personal +800
 *   shared:  Cash −3000         Food +1000       Recv:Sara +1000  Recv:Bilal +1000
 *
 * Spending on a credit card is the same shape with a credit-card account as the
 * source: the card balance goes more negative (the liability grows) and the
 * expense records once.
 */
export function buildSpend(input: SpendInput, ctx: LedgerContext): Result<Transaction> {
  const account = ctx.accounts.get(input.accountId);
  if (!account) return fail('unknown_account', 'Choose an account.', 'accountId');
  if (isCategory(account.class)) {
    return fail('bad_account', 'Choose an account to pay from, not a category.', 'accountId');
  }

  const allocations = (input.allocations ?? []).filter((a) => a.amount !== 0);
  const shares = (input.shares ?? []).filter((s) => s.amount !== 0);

  if (allocations.length === 0 && shares.length === 0) {
    return fail('zero_amount', 'Enter an amount greater than zero.', 'amount');
  }

  const spendGuard = checkAmounts(
    [...allocations.map((x) => x.amount), ...shares.map((x) => x.amount)],
    'amount',
  );
  if (spendGuard) return spendGuard;
  for (const a of allocations) {
    const cat = ctx.accounts.get(a.categoryId);
    if (!cat) return fail('unknown_category', 'Choose a category.', 'categoryId');
    if (cat.class !== 'expense_category') {
      return fail('bad_category', `"${cat.name}" is not a spending category.`, 'categoryId');
    }
    if (a.amount < 0) {
      return fail('negative_split', 'Split amounts cannot be negative. Record a refund instead.', 'amount');
    }
  }
  for (const s of shares) {
    const acc = ctx.accounts.get(s.personAccountId);
    if (!acc) return fail('unknown_person', 'Choose who owes this share.', 'shares');
    if (acc.class !== 'receivable') {
      return fail('bad_person_account', 'Shares must be owed by a person.', 'shares');
    }
    if (s.amount < 0) return fail('negative_share', 'A share cannot be negative.', 'shares');
  }

  const currency = input.currency ?? account.currency;
  const total = sumMinor([...allocations.map((a) => a.amount), ...shares.map((s) => s.amount)]);
  if (total === 0) return fail('zero_amount', 'Enter an amount greater than zero.', 'amount');

  const drafts: DraftPosting[] = [
    { accountId: account.id, amount: -total, currency },
    ...allocations.map((a) => ({
      accountId: a.categoryId,
      amount: a.amount,
      currency,
      memo: a.memo ?? null,
    })),
    ...shares.map((s) => ({
      accountId: s.personAccountId,
      amount: s.amount,
      currency,
      memo: s.memo ?? null,
    })),
  ];

  const postings = materialisePostings(drafts, ctx);
  if (!postings.ok) return postings;

  const txn = shell('expense', input, postings.value, currency, ctx);
  return validateTransaction(txn, ctx);
}

// ---------------------------------------------------------------------------
// Builder 2 — EARN (income)
// ---------------------------------------------------------------------------

export interface EarnInput extends CommonTxnFields {
  accountId: ID;
  allocations: Allocation[];
  currency?: string;
}

/** Build income:  Bank +200000   Salary −200000 */
export function buildEarn(input: EarnInput, ctx: LedgerContext): Result<Transaction> {
  const account = ctx.accounts.get(input.accountId);
  if (!account) return fail('unknown_account', 'Choose an account.', 'accountId');
  if (isCategory(account.class)) {
    return fail('bad_account', 'Choose an account to receive into, not a category.', 'accountId');
  }

  const allocations = (input.allocations ?? []).filter((a) => a.amount !== 0);
  if (allocations.length === 0) return fail('zero_amount', 'Enter an amount greater than zero.', 'amount');

  const earnGuard = checkAmounts(allocations.map((x) => x.amount), 'amount');
  if (earnGuard) return earnGuard;

  for (const a of allocations) {
    const cat = ctx.accounts.get(a.categoryId);
    if (!cat) return fail('unknown_category', 'Choose an income category.', 'categoryId');
    if (cat.class !== 'income_category') {
      return fail('bad_category', `"${cat.name}" is not an income category.`, 'categoryId');
    }
    if (a.amount < 0) return fail('negative_amount', 'Income cannot be negative.', 'amount');
  }

  const currency = input.currency ?? account.currency;
  const total = sumMinor(allocations.map((a) => a.amount));

  const drafts: DraftPosting[] = [
    { accountId: account.id, amount: total, currency },
    ...allocations.map((a) => ({
      accountId: a.categoryId,
      amount: -a.amount,
      currency,
      memo: a.memo ?? null,
    })),
  ];

  const postings = materialisePostings(drafts, ctx);
  if (!postings.ok) return postings;
  return validateTransaction(shell('income', input, postings.value, currency, ctx), ctx);
}

// ---------------------------------------------------------------------------
// Builder 3 — MOVE (transfer, card payment, debt, goal)
// ---------------------------------------------------------------------------

export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export interface MoveInput extends CommonTxnFields {
  kind: MovementKind;
  fromAccountId: ID;
  toAccountId: ID;
  /** Amount leaving the source, in the source account's currency. */
  amount: number;
  /**
   * Amount arriving at the destination, in the destination's currency.
   * Only needed for cross-currency movement; defaults to `amount`.
   */
  toAmount?: number;
}

/**
 * Build a movement between two accounts.
 *
 * This single builder covers transfers, credit-card bill payments, lending,
 * borrowing, debt repayments, and goal contributions — because structurally
 * they are all the same event: value leaves one account and arrives in another,
 * and NO category is touched.
 *
 * That last part is the whole point. A card payment cannot be double-counted as
 * an expense because there is no expense posting to count.
 *
 *   transfer:           Bank −20000       Cash +20000
 *   card payment:       Bank −5000        CreditCard +5000
 *   lend to Sara:       Cash −4000        Recv:Sara +4000
 *   borrow from Bilal:  Cash +15000       Pay:Bilal −15000   (expressed from→to)
 *   goal contribution:  Bank −50000       Goal:Laptop +50000
 */
export function buildMove(input: MoveInput, ctx: LedgerContext): Result<Transaction> {
  const from = ctx.accounts.get(input.fromAccountId);
  const to = ctx.accounts.get(input.toAccountId);
  if (!from) return fail('unknown_account', 'Choose an account to move money from.', 'fromAccountId');
  if (!to) return fail('unknown_account', 'Choose an account to move money to.', 'toAccountId');

  if (from.id === to.id) {
    return fail(
      'same_account',
      'Choose two different accounts — money cannot move to where it already is.',
      'toAccountId',
    );
  }
  if (isCategory(from.class) || isCategory(to.class)) {
    return fail('movement_touches_category', 'A transfer cannot use a spending category.', 'toAccountId');
  }
  if (!isSafeMinor(input.amount)) {
    return fail('bad_amount', 'That amount is not a valid number.', 'amount');
  }
  if (input.amount === 0) return fail('zero_amount', 'Enter an amount greater than zero.', 'amount');
  if (input.amount < 0) {
    return fail(
      'negative_amount',
      'Enter a positive amount and swap the accounts to reverse the direction.',
      'amount',
    );
  }

  const toAmount = input.toAmount ?? input.amount;
  if (!isSafeMinor(toAmount) || toAmount <= 0) {
    return fail('bad_amount', 'The received amount must be greater than zero.', 'toAmount');
  }
  if (from.currency !== to.currency && input.toAmount === undefined) {
    return fail(
      'fx_required',
      `${from.name} is in ${from.currency} and ${to.name} is in ${to.currency}. Enter the amount received.`,
      'toAmount',
    );
  }

  const drafts: DraftPosting[] = [
    { accountId: from.id, amount: -input.amount, currency: from.currency },
    { accountId: to.id, amount: toAmount, currency: to.currency },
  ];

  const postings = materialisePostings(drafts, ctx);
  if (!postings.ok) return postings;
  return validateTransaction(shell(input.kind, input, postings.value, from.currency, ctx), ctx);
}

// ---------------------------------------------------------------------------
// Builder 4 — REFUND
// ---------------------------------------------------------------------------

export interface RefundInput extends CommonTxnFields {
  /** The transaction being refunded. */
  originalTxnId: ID;
  /** Where the money came back to. Usually the original source account. */
  toAccountId: ID;
  /** Which categories to credit back, and how much. */
  allocations: Allocation[];
  currency?: string;
}

/**
 * Build a refund — structurally a reverse expense, linked to its original.
 *
 *   partial refund:  Cash +800   Groceries −800
 *
 * The net expense for Groceries then falls out of plain summation; no report
 * needs refund-specific logic. A card refund is the same shape with the card as
 * the destination, which correctly reduces the card liability.
 *
 * The caller is responsible for checking the refund does not exceed the
 * original — see `refundableRemaining`.
 */
export function buildRefund(input: RefundInput, ctx: LedgerContext): Result<Transaction> {
  const account = ctx.accounts.get(input.toAccountId);
  if (!account) return fail('unknown_account', 'Choose where the refund was received.', 'toAccountId');
  if (isCategory(account.class)) {
    return fail('bad_account', 'Choose an account, not a category.', 'toAccountId');
  }

  const allocations = (input.allocations ?? []).filter((a) => a.amount !== 0);
  if (allocations.length === 0) return fail('zero_amount', 'Enter a refund amount.', 'amount');

  const refundGuard = checkAmounts(allocations.map((x) => x.amount), 'amount');
  if (refundGuard) return refundGuard;

  for (const a of allocations) {
    const cat = ctx.accounts.get(a.categoryId);
    if (!cat) return fail('unknown_category', 'Choose the category being refunded.', 'categoryId');
    if (cat.class !== 'expense_category') {
      return fail('bad_category', `"${cat.name}" is not a spending category.`, 'categoryId');
    }
    if (a.amount < 0) return fail('negative_amount', 'A refund amount cannot be negative.', 'amount');
  }

  const currency = input.currency ?? account.currency;
  const total = sumMinor(allocations.map((a) => a.amount));

  const drafts: DraftPosting[] = [
    { accountId: account.id, amount: total, currency },
    ...allocations.map((a) => ({
      accountId: a.categoryId,
      amount: -a.amount,
      currency,
      memo: a.memo ?? null,
    })),
  ];

  const postings = materialisePostings(drafts, ctx);
  if (!postings.ok) return postings;
  return validateTransaction(
    shell('refund', input, postings.value, currency, ctx, input.originalTxnId),
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Builder 5 — ADJUST (reconciliation) and OPENING BALANCE
// ---------------------------------------------------------------------------

export interface AdjustInput extends CommonTxnFields {
  accountId: ID;
  /** Signed difference to apply to the account. */
  delta: number;
  /** The system adjustment account that absorbs the counter-posting. */
  adjustmentAccountId: ID;
}

/**
 * Reconcile an account to a counted balance.
 *
 *   counted Rs. 3,200 but ledger says Rs. 3,500:
 *   Cash −300   Adjustment +300
 *
 * The difference is posted somewhere visible rather than being absorbed into a
 * silently-edited balance. An unexplained Rs. 300 stays explicit and auditable.
 */
export function buildAdjustment(input: AdjustInput, ctx: LedgerContext): Result<Transaction> {
  const account = ctx.accounts.get(input.accountId);
  const adj = ctx.accounts.get(input.adjustmentAccountId);
  if (!account) return fail('unknown_account', 'Choose an account.', 'accountId');
  if (!adj || adj.class !== 'adjustment') {
    return fail('missing_system_account', 'The adjustments account is missing.', 'adjustmentAccountId');
  }
  if (!isSafeMinor(input.delta)) return fail('bad_amount', 'That amount is not a valid number.', 'delta');
  if (input.delta === 0) {
    return fail('zero_amount', 'The counted balance already matches — nothing to adjust.', 'delta');
  }

  const currency = account.currency;
  const drafts: DraftPosting[] = [
    { accountId: account.id, amount: input.delta, currency },
    { accountId: adj.id, amount: -input.delta, currency },
  ];

  const postings = materialisePostings(drafts, ctx);
  if (!postings.ok) return postings;
  return validateTransaction(shell('adjustment', input, postings.value, currency, ctx), ctx);
}

export interface OpeningInput extends CommonTxnFields {
  accountId: ID;
  /** Signed: negative for a card or loan that already carries a balance. */
  amount: number;
  openingAccountId: ID;
}

/** Seed an account's starting balance:  Bank +100000   OpeningBalance −100000 */
export function buildOpening(input: OpeningInput, ctx: LedgerContext): Result<Transaction> {
  const account = ctx.accounts.get(input.accountId);
  const opening = ctx.accounts.get(input.openingAccountId);
  if (!account) return fail('unknown_account', 'Choose an account.', 'accountId');
  if (!opening || opening.class !== 'opening_balance') {
    return fail('missing_system_account', 'The opening balance account is missing.', 'openingAccountId');
  }
  if (!isSafeMinor(input.amount)) return fail('bad_amount', 'That amount is not a valid number.', 'amount');
  if (input.amount === 0) return fail('zero_amount', 'Enter a starting balance.', 'amount');

  const currency = account.currency;
  const drafts: DraftPosting[] = [
    { accountId: account.id, amount: input.amount, currency },
    { accountId: opening.id, amount: -input.amount, currency },
  ];

  const postings = materialisePostings(drafts, ctx);
  if (!postings.ok) return postings;
  return validateTransaction(shell('opening', input, postings.value, currency, ctx), ctx);
}

// ---------------------------------------------------------------------------
// Builder 6 — CARPOOL SETTLEMENT
// ---------------------------------------------------------------------------

export interface CarpoolSettleInput extends CommonTxnFields {
  /** The rider's receivable account — they now owe this. */
  personAccountId: ID;
  /** Expense category (cost recovery) or income category (earnings). */
  categoryId: ID;
  amount: number;
  currency?: string;
}

/**
 * Bill a rider for a period of carpool trips.
 *
 *   Recv:Sara +2,000   Transport −2,000     (cost recovery — the default)
 *   Recv:Sara +2,000   Carpool   −2,000     (recorded as income instead)
 *
 * Both are the same shape: the receivable rises and a category falls. Which
 * category class is used decides whether the money reads as recovering fuel you
 * already paid for, or as earnings. Nothing is received yet — that happens when
 * the rider actually pays, which is an ordinary `repay_in` movement.
 */
export function buildCarpoolSettlement(
  input: CarpoolSettleInput,
  ctx: LedgerContext,
): Result<Transaction> {
  const person = ctx.accounts.get(input.personAccountId);
  const category = ctx.accounts.get(input.categoryId);

  if (!person) return fail('unknown_person', 'Choose who is being billed.', 'personAccountId');
  if (person.class !== 'receivable') {
    return fail('bad_person_account', 'Carpool charges must be billed to a person.', 'personAccountId');
  }
  if (!category) return fail('unknown_category', 'Choose a category for the money collected.', 'categoryId');
  if (!isCategory(category.class)) {
    return fail('bad_category', `"${category.name}" is not a category.`, 'categoryId');
  }

  const guard = checkAmounts([input.amount], 'amount');
  if (guard) return guard;
  if (input.amount <= 0) {
    return fail('zero_amount', 'There is nothing to bill for this period.', 'amount');
  }

  const currency = input.currency ?? person.currency;
  const drafts: DraftPosting[] = [
    { accountId: person.id, amount: input.amount, currency },
    { accountId: category.id, amount: -input.amount, currency },
  ];

  const postings = materialisePostings(drafts, ctx);
  if (!postings.ok) return postings;
  return validateTransaction(shell('carpool_settlement', input, postings.value, currency, ctx), ctx);
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/** The headline amount of a transaction: total value that moved, in base currency. */
export function txnAmount(txn: Transaction): number {
  return sumMinor(txn.postings.filter((p) => p.baseAmount > 0).map((p) => p.baseAmount));
}

/** The headline amount in the transaction's own currency. */
export function txnAmountOriginal(txn: Transaction): number {
  return sumMinor(txn.postings.filter((p) => p.amount > 0).map((p) => p.amount));
}

/** Signed effect of a transaction on one account, in that account's currency. */
export function effectOnAccount(txn: Transaction, accountId: ID): number {
  return sumMinor(txn.postings.filter((p) => p.accountId === accountId).map((p) => p.amount));
}

/** Base-currency spend recorded by this transaction into expense categories. */
export function expenseAmount(txn: Transaction, accounts: ReadonlyMap<ID, Account>): number {
  return sumMinor(
    txn.postings
      .filter((p) => accounts.get(p.accountId)?.class === 'expense_category')
      .map((p) => p.baseAmount),
  );
}

/** Base-currency income recorded by this transaction. Positive when earned. */
export function incomeAmount(txn: Transaction, accounts: ReadonlyMap<ID, Account>): number {
  // `+ 0` normalises -0, so "no income" compares equal to zero everywhere.
  return (
    -sumMinor(
      txn.postings
        .filter((p) => accounts.get(p.accountId)?.class === 'income_category')
        .map((p) => p.baseAmount),
    ) + 0
  );
}

/**
 * How much of `original` is still refundable, given the refunds already linked.
 * Enforces business rule R5 — refunds can never exceed the original.
 */
export function refundableRemaining(
  original: Transaction,
  allTxns: readonly Transaction[],
  accounts: ReadonlyMap<ID, Account>,
): number {
  if (original.voided) return 0;
  const gross = expenseAmount(original, accounts);
  const refunded = allTxns
    .filter((t) => !t.voided && t.kind === 'refund' && t.linkedTxnId === original.id)
    .reduce((sum, t) => sum + -expenseAmount(t, accounts), 0);
  return Math.max(0, gross - refunded);
}

/** Void a transaction. History is retained; nothing is destroyed. */
export function voidTransaction(txn: Transaction, at: ISOTimestamp): Transaction {
  return { ...txn, voided: true, voidedAt: at, updatedAt: at };
}

export function restoreTransaction(txn: Transaction, at: ISOTimestamp): Transaction {
  return { ...txn, voided: false, voidedAt: null, updatedAt: at };
}

/**
 * A stable fingerprint used to spot probable duplicate imports (R10).
 * Deliberately fuzzy on merchant so "OPTP" and "OPTP  " collide.
 */
export function dedupeHash(parts: {
  date: CalendarDate;
  amount: number;
  accountId: ID;
  merchant?: string | null;
}): string {
  const merchant = (parts.merchant ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  return `${parts.date}|${parts.amount}|${parts.accountId}|${merchant}`;
}

export { MoneyError, assertMinor };
