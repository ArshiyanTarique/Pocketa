/**
 * A draft is what a form produces: a description of an intended transaction,
 * independent of posting shape.
 *
 * Create and edit go through the same path — editing rebuilds the transaction
 * from its draft rather than patching postings in place. That keeps every
 * transaction, however old, subject to the current invariants, and means there
 * is exactly one code path that can produce postings.
 */

import type { CalendarDate } from './dates';
import {
  buildSpend,
  buildEarn,
  buildMove,
  buildRefund,
  buildAdjustment,
  buildOpening,
  type Allocation,
  type LedgerContext,
  type MovementKind,
  type Result,
  type Share,
} from './ledger';
import type { ID, Transaction, TxnKind } from './types';

export interface DraftBase {
  id?: ID;
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
  createdAt?: string;
}

export interface SpendDraft extends DraftBase {
  type: 'spend';
  accountId: ID;
  allocations: Allocation[];
  shares?: Share[];
  currency?: string;
}

export interface EarnDraft extends DraftBase {
  type: 'earn';
  accountId: ID;
  allocations: Allocation[];
  currency?: string;
}

export interface MoveDraft extends DraftBase {
  type: 'move';
  kind: MovementKind;
  fromAccountId: ID;
  toAccountId: ID;
  amount: number;
  toAmount?: number;
}

export interface RefundDraft extends DraftBase {
  type: 'refund';
  originalTxnId: ID;
  toAccountId: ID;
  allocations: Allocation[];
  currency?: string;
}

export interface AdjustDraft extends DraftBase {
  type: 'adjust';
  accountId: ID;
  delta: number;
  adjustmentAccountId: ID;
}

export interface OpeningDraft extends DraftBase {
  type: 'opening';
  accountId: ID;
  amount: number;
  openingAccountId: ID;
}

export type TxnDraft =
  | SpendDraft
  | EarnDraft
  | MoveDraft
  | RefundDraft
  | AdjustDraft
  | OpeningDraft;

/** The single entry point from any form to the ledger. */
export function buildFromDraft(draft: TxnDraft, ctx: LedgerContext): Result<Transaction> {
  switch (draft.type) {
    case 'spend':
      return buildSpend(draft, ctx);
    case 'earn':
      return buildEarn(draft, ctx);
    case 'move':
      return buildMove(draft, ctx);
    case 'refund':
      return buildRefund(draft, ctx);
    case 'adjust':
      return buildAdjustment(draft, ctx);
    case 'opening':
      return buildOpening(draft, ctx);
  }
}

/**
 * Recover the draft that would rebuild an existing transaction, so the edit
 * form can be populated without the UI ever inspecting postings.
 */
export function draftFromTransaction(
  txn: Transaction,
  accounts: ReadonlyMap<ID, { class: string }>,
): TxnDraft | null {
  const base: DraftBase = {
    id: txn.id,
    date: txn.date,
    time: txn.time,
    merchant: txn.merchant,
    notes: txn.notes,
    tags: txn.tags,
    attachmentIds: txn.attachmentIds,
    recurrenceId: txn.recurrenceId,
    occurrenceKey: txn.occurrenceKey,
    importBatchId: txn.importBatchId,
    dedupeHash: txn.dedupeHash,
    createdAt: txn.createdAt,
  };

  const classOf = (id: ID) => accounts.get(id)?.class ?? '';
  const isCat = (id: ID) => classOf(id) === 'expense_category' || classOf(id) === 'income_category';

  switch (txn.kind) {
    case 'expense': {
      const source = txn.postings.find((p) => p.amount < 0 && !isCat(p.accountId));
      if (!source) return null;
      return {
        ...base,
        type: 'spend',
        accountId: source.accountId,
        currency: source.currency,
        allocations: txn.postings
          .filter((p) => classOf(p.accountId) === 'expense_category')
          .map((p) => ({ categoryId: p.accountId, amount: p.amount, memo: p.memo })),
        shares: txn.postings
          .filter((p) => classOf(p.accountId) === 'receivable')
          .map((p) => ({ personAccountId: p.accountId, amount: p.amount, memo: p.memo })),
      };
    }
    case 'income': {
      const dest = txn.postings.find((p) => p.amount > 0 && !isCat(p.accountId));
      if (!dest) return null;
      return {
        ...base,
        type: 'earn',
        accountId: dest.accountId,
        currency: dest.currency,
        allocations: txn.postings
          .filter((p) => classOf(p.accountId) === 'income_category')
          .map((p) => ({ categoryId: p.accountId, amount: -p.amount, memo: p.memo })),
      };
    }
    case 'refund': {
      const dest = txn.postings.find((p) => p.amount > 0 && !isCat(p.accountId));
      if (!dest || !txn.linkedTxnId) return null;
      return {
        ...base,
        type: 'refund',
        originalTxnId: txn.linkedTxnId,
        toAccountId: dest.accountId,
        currency: dest.currency,
        allocations: txn.postings
          .filter((p) => classOf(p.accountId) === 'expense_category')
          .map((p) => ({ categoryId: p.accountId, amount: -p.amount, memo: p.memo })),
      };
    }
    case 'adjustment': {
      const adj = txn.postings.find((p) => classOf(p.accountId) === 'adjustment');
      const target = txn.postings.find((p) => classOf(p.accountId) !== 'adjustment');
      if (!adj || !target) return null;
      return { ...base, type: 'adjust', accountId: target.accountId, delta: target.amount, adjustmentAccountId: adj.accountId };
    }
    case 'opening': {
      const sys = txn.postings.find((p) => classOf(p.accountId) === 'opening_balance');
      const target = txn.postings.find((p) => classOf(p.accountId) !== 'opening_balance');
      if (!sys || !target) return null;
      return { ...base, type: 'opening', accountId: target.accountId, amount: target.amount, openingAccountId: sys.accountId };
    }
    default: {
      // Every movement kind shares one shape.
      const from = txn.postings.find((p) => p.amount < 0);
      const to = txn.postings.find((p) => p.amount > 0);
      if (!from || !to) return null;
      return {
        ...base,
        type: 'move',
        kind: txn.kind as MovementKind,
        fromAccountId: from.accountId,
        toAccountId: to.accountId,
        amount: -from.amount,
        toAmount: to.amount,
      };
    }
  }
}

/** The user-facing label for the kind a draft will produce. */
export function draftKind(draft: TxnDraft): TxnKind {
  switch (draft.type) {
    case 'spend':
      return 'expense';
    case 'earn':
      return 'income';
    case 'move':
      return draft.kind;
    case 'refund':
      return 'refund';
    case 'adjust':
      return 'adjustment';
    case 'opening':
      return 'opening';
  }
}
