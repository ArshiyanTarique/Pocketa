/**
 * How a transaction is described in a list.
 *
 * One function decides this, so a transfer reads identically on the dashboard,
 * in search results, on an account page, and in an export. It also keeps the
 * posting model out of the UI entirely: components ask what to show, never how
 * the money was recorded.
 */

import { sumMinor } from '../core/money';
import type { Account, ID, Transaction, TxnKind } from '../core/types';
import { TXN_KIND_LABELS } from '../core/types';

export interface TxnDisplay {
  title: string;
  subtitle: string;
  /** Base-currency magnitude, always positive. */
  amount: number;
  /** Amount in the transaction's own currency, when it differs from base. */
  nativeAmount: number | null;
  nativeCurrency: string | null;
  /** How the figure should be tinted and signed. */
  direction: 'out' | 'in' | 'neutral';
  kind: TxnKind;
  kindLabel: string;
  color: string | null;
  /** Single letter or emoji shown in the leading token. */
  initial: string;
  categoryNames: string[];
  accountNames: string[];
  isSplit: boolean;
  isShared: boolean;
}

const CATEGORY_CLASSES = new Set(['expense_category', 'income_category']);

export function describeTransaction(
  txn: Transaction,
  accounts: ReadonlyMap<ID, Account>,
): TxnDisplay {
  const parts = txn.postings.map((p) => ({ posting: p, account: accounts.get(p.accountId) }));

  const categories = parts.filter((x) => x.account && CATEGORY_CLASSES.has(x.account.class));
  const nonCategories = parts.filter((x) => x.account && !CATEGORY_CLASSES.has(x.account.class));
  const sources = nonCategories.filter((x) => x.posting.amount < 0);
  const destinations = nonCategories.filter((x) => x.posting.amount > 0);

  const categoryNames = categories.map((c) => c.account!.name);
  const accountNames = nonCategories.map((a) => a.account!.name);

  const expense = sumMinor(
    parts.filter((x) => x.account?.class === 'expense_category').map((x) => x.posting.baseAmount),
  );
  const income = -sumMinor(
    parts.filter((x) => x.account?.class === 'income_category').map((x) => x.posting.baseAmount),
  );

  const gross = sumMinor(txn.postings.filter((p) => p.baseAmount > 0).map((p) => p.baseAmount));
  const nativeGross = sumMinor(txn.postings.filter((p) => p.amount > 0).map((p) => p.amount));

  const isSplit = categories.length > 1;
  const isShared = parts.some((x) => x.account?.class === 'receivable' && x.posting.amount > 0);

  let title: string;
  let subtitle: string;
  let direction: TxnDisplay['direction'];
  let amount = gross;
  let color = categories[0]?.account?.color ?? null;

  switch (txn.kind) {
    case 'expense': {
      title = txn.merchant || categoryNames[0] || 'Expense';
      const where = sources[0]?.account?.name ?? '';
      subtitle = isSplit
        ? `${categoryNames.length} categories · ${where}`
        : [categoryNames[0], where].filter(Boolean).join(' · ');
      if (isShared) subtitle = `Shared · ${subtitle}`;
      direction = 'out';
      // Show what the user actually spent, not what they fronted for the table.
      amount = expense > 0 ? expense : gross;
      break;
    }
    case 'income': {
      title = txn.merchant || categoryNames[0] || 'Income';
      subtitle = [categoryNames[0], destinations[0]?.account?.name].filter(Boolean).join(' · ');
      direction = 'in';
      amount = income;
      break;
    }
    case 'refund': {
      title = txn.merchant ? `Refund — ${txn.merchant}` : 'Refund';
      subtitle = [categoryNames[0], destinations[0]?.account?.name].filter(Boolean).join(' · ');
      direction = 'in';
      break;
    }
    case 'transfer':
    case 'cc_payment':
    case 'goal_contribution':
    case 'goal_withdrawal':
    case 'lend':
    case 'borrow':
    case 'repay_out':
    case 'repay_in': {
      const from = sources[0]?.account?.name ?? '—';
      const to = destinations[0]?.account?.name ?? '—';
      title = txn.merchant || TXN_KIND_LABELS[txn.kind];
      subtitle = `${from} → ${to}`;
      direction = 'neutral';
      color = null;
      break;
    }
    case 'adjustment': {
      const target = parts.find((x) => x.account?.class !== 'adjustment');
      title = 'Balance adjustment';
      subtitle = target?.account?.name ?? '';
      direction = (target?.posting.amount ?? 0) < 0 ? 'out' : 'in';
      color = null;
      break;
    }
    case 'opening':
    default: {
      const target = parts.find((x) => x.account?.class !== 'opening_balance');
      title = 'Opening balance';
      subtitle = target?.account?.name ?? '';
      direction = (target?.posting.amount ?? 0) < 0 ? 'out' : 'in';
      color = null;
      break;
    }
  }

  const currency = txn.currency;
  // A rate of 1 means the posting is already in the base currency, so there is
  // no second figure worth showing.
  const showNative = txn.postings.some((p) => p.fxRate !== 1);

  return {
    title,
    subtitle,
    amount,
    nativeAmount: showNative ? nativeGross : null,
    nativeCurrency: showNative ? currency : null,
    direction,
    kind: txn.kind,
    kindLabel: TXN_KIND_LABELS[txn.kind],
    color,
    initial: initialOf(title),
    categoryNames,
    accountNames,
    isSplit,
    isShared,
  };
}

function initialOf(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '·';
  const first = [...trimmed][0];
  return first.toUpperCase();
}

/** The sign to display in front of an amount, given its direction. */
export function signFor(direction: TxnDisplay['direction']): 'always' | 'auto' | 'never' {
  return direction === 'neutral' ? 'never' : 'always';
}

export function signedAmount(display: TxnDisplay): number {
  return display.direction === 'out' ? -display.amount : display.amount;
}
