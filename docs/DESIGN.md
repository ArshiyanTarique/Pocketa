# Pocketa — Design Specification

**Date:** 2026-09-01 · **Status:** Approved, in implementation

A local-first, account-synced personal finance command centre.

---

## 1. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| D1 | React + TypeScript PWA, static build | Offline-capable, installable on phone + desktop, zero hosting cost |
| D2 | Supabase for auth + sync | Account-centric: log in anywhere, fetch full history. Managed; no server code. Authoritative op ordering makes merges provably correct |
| D3 | IndexedDB is the working copy | App fully functional with no network. Supabase is durability + sync, not the read path |
| D4 | Append-only operation log | One mechanism yields audit trail, undo, time-travel, and a merge-safe sync payload |
| D5 | Postings ledger model | Every user-facing correctness rule becomes a structural invariant, not a remembered filter |
| D6 | Friends' accounts are isolated | Other people are *records* in your ledger, not connected accounts. Addable later via the op log |
| D7 | Google Drive is export-only | Reports/backups written on demand. Never the sync store — avoids flooding users' Drive quota |

## 2. Assumptions (documented, not silent)

| # | Assumption | If wrong |
|---|---|---|
| A1 | Sign-in is **optional**. App works fully offline/anonymous from first launch; signing in adds sync | Add an auth gate at boot |
| A2 | Amounts stored as **integer minor units** (paisa). No floating point in the money path | Non-negotiable correctness requirement |
| A3 | Default currency **PKR**, never hard-coded. Base currency is a user setting | — |
| A4 | FX rates are frozen per transaction at entry, never retro-applied, so historical reports do not change when rates move | — |
| A5 | Natural-language entry uses a **local deterministic parser** (offline, no API key, no cost). An LLM is a pluggable upgrade behind the same interface | Slot in an LLM adapter |
| A6 | One active account per device session; switching account re-syncs | — |
| A7 | Attachments stored as blobs in IndexedDB, size-capped | — |
| A8 | Timestamps are UTC; calendar dates are timezone-naive, so "1st of month" never drifts across time zones | — |

## 3. The ledger model

### Core invariant

> **A transaction's postings sum to exactly zero.**

A transaction is a **header** (date, merchant, notes, tags, attachments, kind, currency) plus **N postings**, each `(accountId, signed minor-unit amount)`.

Categories are internally modelled as accounts. This is never exposed in the UI.

### Account classes

| Class | Counts toward |
|---|---|
| `cash`, `bank`, `savings`, `ewallet`, `investment` | Assets |
| `credit_card`, `loan` | Liabilities |
| `receivable` (people who owe me) | Assets |
| `payable` (people I owe) | Liabilities |
| `goal` | Assets (earmarked) |
| `expense_category` | Expense — excluded from net worth |
| `income_category` | Income — excluded from net worth |
| `adjustment` | System; reconciliation differences |
| `opening_balance` | System; equity counterpart |

### Derived, never stored

```
balance(account) = SUM(posting.amount WHERE posting.accountId = account)
expenses(period) = SUM(postings to expense_category accounts in period)
income(period)   = -SUM(postings to income_category accounts in period)
netWorth(asOf)   = SUM(assets) - SUM(liabilities) for postings dated <= asOf
```

Transfers, credit-card payments, debt movements and goal contributions touch **no category account**, so they cannot appear in any expense or income figure. That is an absence, not a filter.

### Canonical postings

| Scenario | Postings |
|---|---|
| Cash expense 850 | `Cash -850`, `Food +850` |
| Salary 200,000 | `Bank +200000`, `Salary -200000` |
| Transfer Bank to Cash 20,000 | `Bank -20000`, `Cash +20000` |
| Credit-card spend 5,000 | `CreditCard -5000`, `Groceries +5000` |
| Credit-card bill payment 5,000 | `Bank -5000`, `CreditCard +5000` |
| Split 5,000 | `Cash -5000`, `Groceries +3000`, `Household +1200`, `Personal +800` |
| Partial refund 800 | `Cash +800`, `Groceries -800`, linked to original |
| Credit-card refund 800 | `CreditCard +800`, `Groceries -800` |
| Lend Sara 4,000 | `Cash -4000`, `Receivable:Sara +4000` |
| Sara repays 4,000 | `Cash +4000`, `Receivable:Sara -4000` |
| Borrow 15,000 from Bilal | `Cash +15000`, `Payable:Bilal -15000` |
| Repay Bilal 5,000 | `Cash -5000`, `Payable:Bilal +5000` |
| Shared dinner 3,000 three ways | `Cash -3000`, `Food +1000`, `Receivable:Sara +1000`, `Receivable:Bilal +1000` |
| Goal contribution 50,000 | `Bank -50000`, `Goal:Laptop +50000` |
| Cash reconcile -300 | `Cash -300`, `Adjustment +300` |
| Opening balance 100,000 | `Bank +100000`, `OpeningBalance -100000` |

### Multi-currency

Each posting carries `amount` (original currency) and `baseAmount` (base currency, frozen at entry via `fxRate`). The zero-sum invariant is enforced on **both** independently.

## 4. Operation log

Every mutation is an immutable op:

```
{ id, deviceId, lamport, createdAt, type, payload }
```

Rules:

- Ops are **never** deleted or edited. A correction is a new op.
- Entity state is a fold of its ops in `(lamport, deviceId)` order.
- Deleting a transaction appends `TxnVoided`; the row remains for audit and can be restored.
- Deleting a category appends `CategoryArchived`; historical postings keep pointing at it. Historical data is never destroyed.

### Sync

1. Local ops queue in IndexedDB with `synced: false`.
2. On connectivity, push unsynced ops; Supabase assigns a monotonic `serverSeq`.
3. Pull ops with `serverSeq > lastSeen`; merge by op `id`, which is idempotent.
4. Replay in `serverSeq` order to rebuild projections.
5. Concurrent amends to the same field resolve last-write-wins by `serverSeq`, and **both** ops remain visible in audit history.

## 5. Business rules

- **R1** Postings sum to zero, in original and base currency.
- **R2** Zero-amount transactions are rejected with a clear message.
- **R3** Negative amounts are never entered directly; direction comes from transaction kind.
- **R4** A transfer where source equals destination is rejected.
- **R5** Refund total may not exceed the original transaction's net amount.
- **R6** Split legs sum exactly to the parent; the remainder is auto-assigned to avoid rounding drift.
- **R7** Archived accounts accept no new transactions but retain full history.
- **R8** A recurrence template is never mutated by a single occurrence's override.
- **R9** Missed occurrences are materialised as overdue, never silently skipped.
- **R10** Imports are duplicate-checked on a fuzzy hash of (date, amount, account, merchant); the user confirms before commit.
- **R11** AI-parsed transactions **always** require explicit confirmation before any op is written.
- **R12** Safe-to-Spend always shows its full itemised derivation. Never framed as advice.

## 6. Safe to Spend

```
  liquid balances (cash, bank, ewallet; excludes investments, goals, credit)
- unpaid bills due before next expected income
- remaining scheduled goal contributions this period
- outstanding credit-card statement balance
= Safe to Spend
```

Always rendered line by line, never as a bare number.

## 7. Milestones

| M | Scope | Exit criteria |
|---|---|---|
| M1 | Money primitives, postings engine, invariants, op log, projections | Unit tests green for all §3 scenarios and all §8 edge cases |
| M2 | IndexedDB persistence, repositories, seed data | Data survives restart; balances rebuild from log |
| M3 | Design system, app shell, navigation, light/dark | Renders on mobile and desktop, accessible contrast |
| M4 | Accounts, transaction list, quick-add, search and filter | Full CRUD via ops; audit visible |
| M5 | Transfers, credit cards, refunds, splits, shared expenses, debts | Edge-case suite green |
| M6 | Budgets, bills and recurring, goals | Projection and warning logic tested |
| M7 | Dashboard, Safe-to-Spend, analytics | Derivations match engine tests |
| M8 | Import/export (CSV, XLSX, JSON, PDF), backup and restore | Round-trip fidelity test |
| M9 | Supabase auth and sync, offline queue | Two-client merge test |
| M10 | NL entry, PWA polish, empty/loading/error states, final edge-case pass | Full checklist green |

## 8. Edge cases — explicitly tested

Zero amounts · negative values · very large amounts · decimal precision · duplicate transactions · duplicate imports · transfers · same-account transfer · credit-card payment · credit-card refund · full refund · partial refund · split transactions · shared expenses · debt repayment · borrowed money · lent money · recurring transactions · missed recurrences · changed recurring amount · leap years · Feb 29 · month-end dates · year-end · historical edits · deleted transactions · archived accounts · negative balances · cash reconciliation · deleted categories with history · currency conversion · offline usage · app restart · backup restoration · time-zone changes
