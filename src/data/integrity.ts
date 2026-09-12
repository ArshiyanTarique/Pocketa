/**
 * Referential integrity.
 *
 * IndexedDB has no foreign keys, no check constraints and no unique indexes
 * beyond the ones declared up front. Everything a relational database would
 * refuse to store, it will happily keep. So the constraints have to live
 * somewhere, and this is where.
 *
 * It is not a validator for ordinary entry — the ledger builders already refuse
 * to construct a bad transaction. It guards the two doors where data arrives
 * without passing through them:
 *
 *   1. **A restored backup.** A file that has been truncated, hand-edited, or
 *      written by a different version.
 *   2. **Ops pulled from a peer.** Another device, possibly running an older
 *      build, possibly with its own corruption.
 *
 * Issues are graded. A `fatal` one means the data cannot be trusted and must
 * not be written. A `repairable` one is a dangling reference that can be
 * cleared without losing anything real — a receipt pointing at a transaction
 * that no longer exists is worth mending, not worth refusing an entire restore
 * over.
 */

import { isCategory, type Account, type Attachment, type Budget, type Carpool, type CarpoolRider, type CarpoolSettlement, type CarpoolTrip, type Debt, type Goal, type ID, type ImportBatch, type OccurrenceOverride, type Person, type Recurrence, type Settings, type Transaction } from '../core/types';
import { isValidDate } from '../core/dates';
import type { Op } from './oplog';

export type Severity = 'fatal' | 'repairable';

export interface IntegrityIssue {
  code: string;
  severity: Severity;
  table: string;
  /** The row at fault, so a report can point at something. */
  id: ID;
  message: string;
}

export interface IntegrityReport {
  ok: boolean;
  fatal: number;
  repairable: number;
  counts: Record<string, number>;
  issues: IntegrityIssue[];
}

/** Everything the checker needs. Both the live store and a snapshot satisfy it. */
export interface Dataset {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  budgets: readonly Budget[];
  recurrences: readonly Recurrence[];
  overrides: readonly OccurrenceOverride[];
  goals: readonly Goal[];
  debts: readonly Debt[];
  people: readonly Person[];
  imports: readonly ImportBatch[];
  carpools: readonly Carpool[];
  carpoolRiders: readonly CarpoolRider[];
  carpoolTrips: readonly CarpoolTrip[];
  carpoolSettlements: readonly CarpoolSettlement[];
  ops: readonly Op[];
  settings: readonly Settings[];
  /** Optional: a backup taken without receipts simply has none to check. */
  attachments?: readonly Attachment[];
}

/**
 * Beyond this, a double can no longer represent every integer, so arithmetic
 * on minor units stops being exact. It is far past any real balance and far
 * short of the point where a corrupt file could hide.
 */
const MAX_MINOR = Number.MAX_SAFE_INTEGER;

function isMinorUnits(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= MAX_MINOR;
}

function ids<T extends { id: ID }>(rows: readonly T[]): Set<ID> {
  return new Set(rows.map((r) => r.id));
}

// ---------------------------------------------------------------------------

export function checkIntegrity(data: Dataset): IntegrityReport {
  const issues: IntegrityIssue[] = [];
  const add = (severity: Severity, code: string, table: string, id: ID, message: string) =>
    issues.push({ severity, code, table, id, message });

  const accountIds = ids(data.accounts);
  const txnIds = ids(data.transactions);
  const personIds = ids(data.people);
  const recurrenceIds = ids(data.recurrences);
  const carpoolIds = ids(data.carpools);
  const riderIds = ids(data.carpoolRiders);
  const settlementIds = ids(data.carpoolSettlements);
  const goalIds = ids(data.goals);
  const attachmentIds = data.attachments ? ids(data.attachments) : null;

  const categoryIds = new Set(data.accounts.filter((a) => isCategory(a.class)).map((a) => a.id));

  // --- duplicate primary keys ---------------------------------------------
  // A snapshot is a plain array. Nothing stops it carrying the same id twice,
  // and a restore would silently keep whichever landed last.
  const tables: Array<[string, readonly { id: ID }[]]> = [
    ['accounts', data.accounts],
    ['transactions', data.transactions],
    ['budgets', data.budgets],
    ['recurrences', data.recurrences],
    ['overrides', data.overrides],
    ['goals', data.goals],
    ['debts', data.debts],
    ['people', data.people],
    ['imports', data.imports],
    ['carpools', data.carpools],
    ['carpoolRiders', data.carpoolRiders],
    ['carpoolTrips', data.carpoolTrips],
    ['carpoolSettlements', data.carpoolSettlements],
    ['ops', data.ops],
  ];
  for (const [table, rows] of tables) {
    const seen = new Set<ID>();
    for (const row of rows) {
      if (!row.id) add('fatal', 'missing_id', table, '', 'A row has no id.');
      else if (seen.has(row.id)) add('fatal', 'duplicate_id', table, row.id, `Two rows share the id ${row.id}.`);
      else seen.add(row.id);
    }
  }

  // --- accounts -------------------------------------------------------------
  for (const account of data.accounts) {
    if (!account.name?.trim()) add('fatal', 'blank_name', 'accounts', account.id, 'An account has no name.');
    if (!account.currency) add('fatal', 'no_currency', 'accounts', account.id, `${account.name} has no currency.`);
    if (account.parentId && !accountIds.has(account.parentId)) {
      add('repairable', 'orphan_parent', 'accounts', account.id, `${account.name} sits under a category that no longer exists.`);
    }
    if (account.personId && !personIds.has(account.personId)) {
      add('repairable', 'orphan_person', 'accounts', account.id, `${account.name} points at a person who is not in this data.`);
    }
    if (account.goalId && !goalIds.has(account.goalId)) {
      add('repairable', 'orphan_goal', 'accounts', account.id, `${account.name} points at a goal that is not in this data.`);
    }
    if (account.creditLimit != null && !isMinorUnits(account.creditLimit)) {
      add('fatal', 'bad_amount', 'accounts', account.id, `${account.name} has a credit limit that is not a whole amount.`);
    }
  }

  // A category cycle would make the tree walk on the Categories screen hang.
  const parentOf = new Map(data.accounts.map((a) => [a.id, a.parentId]));
  for (const account of data.accounts) {
    const seen = new Set<ID>([account.id]);
    let cursor = account.parentId;
    while (cursor) {
      if (seen.has(cursor)) {
        add('fatal', 'parent_cycle', 'accounts', account.id, `${account.name} is its own ancestor.`);
        break;
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  // --- transactions ---------------------------------------------------------
  for (const txn of data.transactions) {
    if (!isValidDate(txn.date)) {
      add('fatal', 'bad_date', 'transactions', txn.id, `A transaction has an unreadable date (${String(txn.date)}).`);
    }
    if (!Array.isArray(txn.postings) || txn.postings.length < 2) {
      add('fatal', 'too_few_postings', 'transactions', txn.id, 'A transaction has fewer than two sides.');
      continue;
    }

    let sum = 0;
    let baseSum = 0;
    for (const posting of txn.postings) {
      if (!isMinorUnits(posting.amount) || !isMinorUnits(posting.baseAmount)) {
        add('fatal', 'bad_amount', 'transactions', txn.id, 'A transaction holds an amount that is not a whole number of paisa.');
        continue;
      }
      if (!Number.isFinite(posting.fxRate) || posting.fxRate <= 0) {
        add('fatal', 'bad_fx_rate', 'transactions', txn.id, 'A transaction has an impossible exchange rate.');
      }
      if (!accountIds.has(posting.accountId)) {
        // Fatal, not repairable: dropping the side would break the zero sum,
        // and inventing an account would be a guess about someone's money.
        add('fatal', 'orphan_posting', 'transactions', txn.id, 'A transaction points at an account that is not in this data.');
      }
      sum += posting.amount;
      baseSum += posting.baseAmount;
    }

    if (sum !== 0 || baseSum !== 0) {
      add('fatal', 'not_balanced', 'transactions', txn.id, 'A transaction does not balance — its sides do not sum to zero.');
    }

    if (txn.linkedTxnId && !txnIds.has(txn.linkedTxnId)) {
      add('repairable', 'orphan_link', 'transactions', txn.id, 'A refund points at an original that is no longer here.');
    }
    if (txn.recurrenceId && !recurrenceIds.has(txn.recurrenceId)) {
      add('repairable', 'orphan_recurrence', 'transactions', txn.id, 'A transaction points at a bill that no longer exists.');
    }
    if (txn.voided && !txn.voidedAt) {
      add('repairable', 'void_without_date', 'transactions', txn.id, 'A deleted transaction has no deletion date.');
    }
    if (attachmentIds) {
      for (const attachmentId of txn.attachmentIds ?? []) {
        if (!attachmentIds.has(attachmentId)) {
          add('repairable', 'orphan_attachment_ref', 'transactions', txn.id, 'A transaction lists a receipt that is not in this data.');
        }
      }
    }
  }

  // --- budgets --------------------------------------------------------------
  for (const budget of data.budgets) {
    if (!isMinorUnits(budget.limit) || budget.limit < 0) {
      add('fatal', 'bad_amount', 'budgets', budget.id, `Budget "${budget.name}" has a limit that is not a whole amount.`);
    }
    for (const categoryId of budget.categoryIds ?? []) {
      if (!accountIds.has(categoryId)) {
        add('repairable', 'orphan_category', 'budgets', budget.id, `Budget "${budget.name}" covers a category that no longer exists.`);
      } else if (!categoryIds.has(categoryId)) {
        add('repairable', 'not_a_category', 'budgets', budget.id, `Budget "${budget.name}" covers something that is not a category.`);
      }
    }
  }

  // --- recurrences and their overrides --------------------------------------
  for (const rec of data.recurrences) {
    if (!isMinorUnits(rec.amount)) {
      add('fatal', 'bad_amount', 'recurrences', rec.id, `"${rec.name}" has an amount that is not a whole number of paisa.`);
    }
    if (!accountIds.has(rec.accountId)) {
      add('fatal', 'orphan_account', 'recurrences', rec.id, `"${rec.name}" is paid from an account that is not in this data.`);
    }
    if (rec.categoryId && !accountIds.has(rec.categoryId)) {
      add('repairable', 'orphan_category', 'recurrences', rec.id, `"${rec.name}" points at a category that no longer exists.`);
    }
    if (rec.toAccountId && !accountIds.has(rec.toAccountId)) {
      add('repairable', 'orphan_account', 'recurrences', rec.id, `"${rec.name}" transfers to an account that no longer exists.`);
    }
    if (!isValidDate(rec.startDate)) {
      add('fatal', 'bad_date', 'recurrences', rec.id, `"${rec.name}" starts on an unreadable date.`);
    }
  }

  const occurrenceKeys = new Set<string>();
  for (const override of data.overrides) {
    if (!recurrenceIds.has(override.recurrenceId)) {
      add('repairable', 'orphan_recurrence', 'overrides', override.id, 'A bill occurrence belongs to a bill that no longer exists.');
    }
    if (override.txnId && !txnIds.has(override.txnId)) {
      add('repairable', 'orphan_txn', 'overrides', override.id, 'A bill is marked paid by a transaction that is not here.');
    }
    if (override.amount != null && !isMinorUnits(override.amount)) {
      add('fatal', 'bad_amount', 'overrides', override.id, 'A bill occurrence has an amount that is not a whole number of paisa.');
    }
    // One override per occurrence, or the same bill can be both paid and skipped.
    const key = `${override.recurrenceId}:${override.dueDate}`;
    if (occurrenceKeys.has(key)) {
      add('repairable', 'duplicate_occurrence', 'overrides', override.id, 'The same bill occurrence has been recorded twice.');
    }
    occurrenceKeys.add(key);
  }

  // --- goals, debts, people -------------------------------------------------
  for (const goal of data.goals) {
    if (!isMinorUnits(goal.targetAmount) || goal.targetAmount < 0) {
      add('fatal', 'bad_amount', 'goals', goal.id, `Goal "${goal.name}" has a target that is not a whole amount.`);
    }
    if (!accountIds.has(goal.accountId)) {
      add('fatal', 'orphan_account', 'goals', goal.id, `Goal "${goal.name}" has no account holding its money.`);
    }
    if (goal.plannedContribution != null && !isMinorUnits(goal.plannedContribution)) {
      add('fatal', 'bad_amount', 'goals', goal.id, `Goal "${goal.name}" has a contribution that is not a whole amount.`);
    }
  }

  for (const debt of data.debts) {
    if (!isMinorUnits(debt.principal)) {
      add('fatal', 'bad_amount', 'debts', debt.id, `"${debt.name}" has a principal that is not a whole amount.`);
    }
    if (!personIds.has(debt.personId)) {
      add('fatal', 'orphan_person', 'debts', debt.id, `"${debt.name}" is owed by somebody who is not in this data.`);
    }
    if (!accountIds.has(debt.accountId)) {
      add('fatal', 'orphan_account', 'debts', debt.id, `"${debt.name}" has no account carrying its balance.`);
    }
  }

  // --- carpool --------------------------------------------------------------
  for (const carpool of data.carpools) {
    if (!isMinorUnits(carpool.ratePerTrip) || carpool.ratePerTrip < 0) {
      add('fatal', 'bad_amount', 'carpools', carpool.id, `Carpool "${carpool.name}" has a rate that is not a whole amount.`);
    }
    if (carpool.settleCategoryId && !accountIds.has(carpool.settleCategoryId)) {
      add('repairable', 'orphan_category', 'carpools', carpool.id, `Carpool "${carpool.name}" bills to a category that no longer exists.`);
    }
  }

  for (const rider of data.carpoolRiders) {
    if (!carpoolIds.has(rider.carpoolId)) {
      add('repairable', 'orphan_carpool', 'carpoolRiders', rider.id, 'A rider belongs to a carpool that no longer exists.');
    }
    if (!personIds.has(rider.personId)) {
      add('fatal', 'orphan_person', 'carpoolRiders', rider.id, 'A rider is not a person in this data.');
    }
    if (rider.ratePerTrip != null && !isMinorUnits(rider.ratePerTrip)) {
      add('fatal', 'bad_amount', 'carpoolRiders', rider.id, 'A rider has a rate that is not a whole amount.');
    }
  }

  for (const trip of data.carpoolTrips) {
    if (!carpoolIds.has(trip.carpoolId)) {
      add('repairable', 'orphan_carpool', 'carpoolTrips', trip.id, 'A trip belongs to a carpool that no longer exists.');
    }
    if (!isValidDate(trip.date)) {
      add('fatal', 'bad_date', 'carpoolTrips', trip.id, 'A trip has an unreadable date.');
    }
    for (const id of trip.riderIds ?? []) {
      if (!riderIds.has(id)) {
        add('repairable', 'orphan_rider', 'carpoolTrips', trip.id, 'A trip lists a rider who is not in this data.');
      }
    }
    for (const [id, rate] of Object.entries(trip.rates ?? {})) {
      if (!isMinorUnits(rate)) {
        add('fatal', 'bad_amount', 'carpoolTrips', trip.id, 'A trip has a frozen rate that is not a whole amount.');
      }
      if (!(trip.riderIds ?? []).includes(id)) {
        add('repairable', 'stale_rate', 'carpoolTrips', trip.id, 'A trip holds a rate for somebody who was not on it.');
      }
    }
    if (trip.settlementId && !settlementIds.has(trip.settlementId)) {
      // Serious: the stamp is what stops a trip being billed twice. Clearing it
      // would make the trip billable again, so this is never repaired quietly.
      add('fatal', 'orphan_settlement', 'carpoolTrips', trip.id, 'A trip is marked as billed by a settlement that is not here.');
    }
  }

  for (const settlement of data.carpoolSettlements) {
    if (!carpoolIds.has(settlement.carpoolId)) {
      add('repairable', 'orphan_carpool', 'carpoolSettlements', settlement.id, 'A billing belongs to a carpool that no longer exists.');
    }
    let lineTotal = 0;
    for (const line of settlement.lines ?? []) {
      if (!isMinorUnits(line.amount)) {
        add('fatal', 'bad_amount', 'carpoolSettlements', settlement.id, 'A billing line is not a whole amount.');
      } else {
        lineTotal += line.amount;
      }
      if (line.txnId && !txnIds.has(line.txnId)) {
        add('repairable', 'orphan_txn', 'carpoolSettlements', settlement.id, 'A billing line points at a charge that is not here.');
      }
    }
    if (isMinorUnits(settlement.total) && lineTotal !== settlement.total) {
      add('fatal', 'total_mismatch', 'carpoolSettlements', settlement.id, 'A billing total does not match the lines it is made of.');
    }
  }

  // --- receipts -------------------------------------------------------------
  for (const attachment of data.attachments ?? []) {
    if (attachment.txnId && !txnIds.has(attachment.txnId)) {
      add('repairable', 'orphan_txn', 'attachments', attachment.id, 'A receipt is attached to a transaction that is not here.');
    }
    if (!Number.isFinite(attachment.size) || attachment.size < 0) {
      add('repairable', 'bad_size', 'attachments', attachment.id, 'A receipt reports an impossible size.');
    }
  }

  // --- settings and the op log ----------------------------------------------
  if (data.settings.length !== 1) {
    add('fatal', 'settings_count', 'settings', 'settings', `There should be exactly one settings row, and there ${data.settings.length === 0 ? 'are none' : `are ${data.settings.length}`}.`);
  }
  for (const settings of data.settings) {
    if (!settings.baseCurrency) {
      add('fatal', 'no_currency', 'settings', settings.id, 'The base currency is missing.');
    }
    for (const [code, rate] of Object.entries(settings.fxRates ?? {})) {
      if (!Number.isFinite(rate) || rate <= 0) {
        add('repairable', 'bad_fx_rate', 'settings', settings.id, `The stored rate for ${code} is not a usable number.`);
      }
    }
  }

  for (const op of data.ops) {
    if (!Number.isFinite(op.lamport) || op.lamport < 0) {
      add('fatal', 'bad_lamport', 'ops', op.id, 'A history entry has an impossible sequence number.');
    }
    if (!op.entityId) {
      add('repairable', 'no_entity', 'ops', op.id, 'A history entry names nothing.');
    }
  }

  const fatal = issues.filter((i) => i.severity === 'fatal').length;
  return {
    ok: fatal === 0,
    fatal,
    repairable: issues.length - fatal,
    counts: {
      accounts: data.accounts.length,
      transactions: data.transactions.length,
      budgets: data.budgets.length,
      recurrences: data.recurrences.length,
      overrides: data.overrides.length,
      goals: data.goals.length,
      debts: data.debts.length,
      people: data.people.length,
      carpools: data.carpools.length,
      carpoolTrips: data.carpoolTrips.length,
      ops: data.ops.length,
    },
    issues,
  };
}

/**
 * Mend what can be mended, without inventing anything.
 *
 * Only ever clears a reference or drops a row that points at nothing. It never
 * fabricates an account, changes an amount, or alters a figure the user
 * entered — a repair that guesses is worse than a report that admits.
 *
 * Returns a new dataset; the input is not touched.
 */
export function repairDataset(data: Dataset): { data: Dataset; repaired: number } {
  const accountIds = ids(data.accounts);
  const txnIds = ids(data.transactions);
  const personIds = ids(data.people);
  const recurrenceIds = ids(data.recurrences);
  const carpoolIds = ids(data.carpools);
  const riderIds = ids(data.carpoolRiders);
  const goalIds = ids(data.goals);
  const categoryIds = new Set(data.accounts.filter((a) => isCategory(a.class)).map((a) => a.id));
  const attachmentIds = data.attachments ? ids(data.attachments) : null;

  let repaired = 0;
  const mend = <T>(value: T): T => {
    repaired += 1;
    return value;
  };

  const accounts = data.accounts.map((a) => {
    let next = a;
    if (a.parentId && !accountIds.has(a.parentId)) next = mend({ ...next, parentId: null });
    if (a.personId && !personIds.has(a.personId)) next = mend({ ...next, personId: null });
    if (a.goalId && !goalIds.has(a.goalId)) next = mend({ ...next, goalId: null });
    return next;
  });

  const transactions = data.transactions.map((t) => {
    let next = t;
    if (t.linkedTxnId && !txnIds.has(t.linkedTxnId)) next = mend({ ...next, linkedTxnId: null });
    if (t.recurrenceId && !recurrenceIds.has(t.recurrenceId)) {
      next = mend({ ...next, recurrenceId: null, occurrenceKey: null });
    }
    if (t.voided && !t.voidedAt) next = mend({ ...next, voidedAt: t.updatedAt });
    if (attachmentIds) {
      const kept = (t.attachmentIds ?? []).filter((id) => attachmentIds.has(id));
      if (kept.length !== (t.attachmentIds ?? []).length) next = mend({ ...next, attachmentIds: kept });
    }
    return next;
  });

  const budgets = data.budgets.map((b) => {
    const kept = (b.categoryIds ?? []).filter((id) => categoryIds.has(id));
    return kept.length === (b.categoryIds ?? []).length ? b : mend({ ...b, categoryIds: kept });
  });

  const recurrences = data.recurrences.map((r) => {
    let next = r;
    if (r.categoryId && !accountIds.has(r.categoryId)) next = mend({ ...next, categoryId: null });
    if (r.toAccountId && !accountIds.has(r.toAccountId)) next = mend({ ...next, toAccountId: null });
    return next;
  });

  // Overrides that belong to nothing are dropped rather than cleared: an
  // override with no bill is not a record of anything.
  const seenOccurrences = new Set<string>();
  const overrides: OccurrenceOverride[] = [];
  for (const o of [...data.overrides].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const key = `${o.recurrenceId}:${o.dueDate}`;
    if (!recurrenceIds.has(o.recurrenceId) || seenOccurrences.has(key)) {
      repaired += 1;
      continue;
    }
    seenOccurrences.add(key);
    overrides.push(o.txnId && !txnIds.has(o.txnId) ? mend({ ...o, txnId: null }) : o);
  }

  const carpools = data.carpools.map((c) =>
    c.settleCategoryId && !accountIds.has(c.settleCategoryId)
      ? mend({ ...c, settleCategoryId: null })
      : c,
  );

  const carpoolRiders = data.carpoolRiders.filter((r) => {
    if (carpoolIds.has(r.carpoolId)) return true;
    repaired += 1;
    return false;
  });

  const carpoolTrips = data.carpoolTrips
    .filter((t) => {
      if (carpoolIds.has(t.carpoolId)) return true;
      repaired += 1;
      return false;
    })
    .map((t) => {
      const keptRiders = (t.riderIds ?? []).filter((id) => riderIds.has(id));
      const keptRates = Object.fromEntries(
        Object.entries(t.rates ?? {}).filter(([id]) => keptRiders.includes(id)),
      );
      const changed =
        keptRiders.length !== (t.riderIds ?? []).length ||
        Object.keys(keptRates).length !== Object.keys(t.rates ?? {}).length;
      return changed ? mend({ ...t, riderIds: keptRiders, rates: keptRates }) : t;
    });

  const carpoolSettlements = data.carpoolSettlements.filter((s) => {
    if (carpoolIds.has(s.carpoolId)) return true;
    repaired += 1;
    return false;
  });

  const attachments = data.attachments?.map((a) =>
    a.txnId && !txnIds.has(a.txnId) ? mend({ ...a, txnId: null }) : a,
  );

  return {
    repaired,
    data: {
      ...data,
      accounts,
      transactions,
      budgets,
      recurrences,
      overrides,
      carpools,
      carpoolRiders,
      carpoolTrips,
      carpoolSettlements,
      ...(attachments ? { attachments } : {}),
    },
  };
}

/** One line per problem, for a report a person can act on. */
export function summariseIssues(report: IntegrityReport): string[] {
  const byMessage = new Map<string, number>();
  for (const issue of report.issues) {
    byMessage.set(issue.message, (byMessage.get(issue.message) ?? 0) + 1);
  }
  return [...byMessage.entries()].map(([message, count]) =>
    count === 1 ? message : `${message} (${count} times)`,
  );
}
