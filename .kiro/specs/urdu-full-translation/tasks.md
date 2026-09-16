# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Urdu Rendering in All Screens
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: For each affected screen, render it with `settings.language = 'ur'` and assert that a known English literal is absent from the output (e.g. "Left to spend" absent in Dashboard, "Net worth" absent in Accounts, "Still available" absent in Budgets, "People" absent in Debts, "Nothing to analyse yet" absent in Analytics).
  - The test assertions should match the Expected Behavior Properties from design (Property 1): every user-facing string is Urdu, not English.
  - Run test on UNFIXED code — the English strings will still be present because no `useT()` is called in these screens.
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the bug exists)
  - Document counterexamples found: e.g. "Dashboard renders 'Left to spend' in Urdu mode instead of 'خرچ کرنے کے لیے باقی'"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - English Rendering and Existing Translations Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: `translate('Left to spend', 'en')` returns `'Left to spend'` on unfixed code
  - Observe: `translate('Home', 'ur')` returns `'ہوم'` on unfixed code (existing UR entry)
  - Observe: `translate('nonexistent key', 'ur')` returns `'nonexistent key'` on unfixed code (fallback)
  - Write property-based test: for all keys in UR (before fix), `translate(key, 'en') === key`
  - Write property-based test: for all keys already in UR (before fix), `translate(key, 'ur') === existingUrduValue`
  - Write property-based test: for any key not in UR, `translate(key, 'ur') === key`
  - Verify tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix — wrap all screens with t() and expand the UR dictionary

  - [ ] 3.1 Expand the UR dictionary in `src/app/i18n.ts`
    - Add all new key–value pairs covering every string found across Dashboard, Transactions,
      Accounts, Budgets, Bills, Goals, Debts, Analytics, Settings, Carpool, and Me screens.
    - Group new entries by screen with a comment header (e.g. `// Dashboard`, `// Accounts`, etc.).
    - Do NOT modify or remove any existing entry.
    - Key = exact English string used as the `t()` argument; value = correct Urdu translation.
    - Cover at minimum these new keys per screen (see design.md Fix Implementation for the full list):
      - Dashboard: "Left to spend", "This month", "Recent", "See all", "No transactions yet",
        "Start here", "Explore with sample data", "Import a CSV instead", "Settle up",
        "Record them", "All bills", "All budgets", "Bill the month"
      - Transactions: "Search transactions", "Nothing matches", "No transactions yet",
        "Clear search", "Where the money moved", "Linked", "Refund of", "Refunded",
        "Delete this transaction?", "This transaction is deleted"
      - Accounts: "Net worth", "Own", "Owe", "Assets", "Liabilities", "No accounts yet",
        "Add your first account", "Nothing recorded yet", "Reconcile", "Unarchive",
        "Pocketa says", "You counted", "Adjustment", "Balance reconciled"
      - Budgets: "Still available", "No budgets yet", "Create a budget", "Heading for",
        "Remaining", "Per remaining day", "Restart fresh", "Carry unspent forward",
        "Move unspent to an account", "Transfer surplus into", "Create budget"
      - Bills: "Bills · a month", "Add a bill", "Nothing due", "Overdue", "Coming up",
        "Record payment", "Change", "Skip", "Mark paid", "Reset to scheduled",
        "Due", "Recently settled", "All bills", "Every bill", "Money out", "Money in",
        "Remind me this many days ahead", "Record this automatically"
      - Goals: "Set aside", "Target", "Reached", "New goal", "No goals yet", "Create a goal",
        "Add money", "Take out", "Each week", "Each month", "Still needed",
        "Fully funded.", "Withdraw it whenever you need it.",
        "What are you saving for?", "Target amount", "Target date",
        "Planned monthly contribution", "Take money out"
      - Debts: "Net in your favour", "Net you owe", "Owed to you", "People",
        "Add person", "Borrow", "Lend", "No people yet", "All square",
        "They paid back", "Pay back", "WhatsApp", "Add a person",
        "Lend money", "Record a repayment", "Borrow money", "Repay what you owe",
        "Outstanding", "Received into", "Due back by", "Record",
        "I lent money", "I borrowed money", "They paid me back", "I paid them back",
        "Owes you", "Total lent", "Total borrowed", "Repaid so far",
        "Net, in your favour", "Net, you owe", "Record a payment"
      - Analytics: "Cash flow", "Daily", "Last 12 months", "Merchants", "Largest",
        "Nothing to analyse yet", "No spending in this period", "No merchants recorded",
        "No expenses in this period", "Not enough history to compare",
        "Above its six-month average by", "Below its six-month average by",
        "About the same as usual", "transaction", "transactions", "visit", "visits"
      - Settings: "Your account", "Sync across devices", "Sign out", "Sync now",
        "Continue with Google", "Send link", "Text size", "Very Large",
        "Display density", "Language / زبان", "Exchange rates",
        "Look ahead", "Spending", "Bring data in", "Take data out", "Backup",
        "Import from CSV", "CSV", "Spreadsheet", "PDF report",
        "Save a backup", "Restore a backup",
        "Save a smaller backup without receipts",
        "Start over", "Erase everything on this device",
        "Run the check", "Everything adds up", "Storage", "Check this ledger",
        "Add category", "Save rates", "Record this automatically", "Sits under", "Top level", "Colour"
      - Carpool: "Stop counting from memory", "Set up the carpool",
        "What is this run called?", "Rate per person, per trip",
        "Money collected goes against", "No trip logged today",
        "Some days are still unlogged", "Log today", "Another day",
        "Today · who is in the car?", "Nobody rode", "Trips", "Riders", "Each",
        "Log a trip", "Bill everyone", "Add a rider", "Who owes what",
        "No riders yet", "No trips this month", "Trip log", "lifetime",
        "Nothing logged this month", "Billed", "Edit trip",
        "Who was in the car?", "Tap to toggle. Starts with whoever rode last time.",
        "Save trip", "Log"
      - Me: "None set", "On track", "at risk", "Nothing due", "due this week",
        "overdue", "All square", "None yet", "Show amounts"
    - _Bug_Condition: isBugCondition({ lang: 'ur', screen }) — any screen where t() is not called_
    - _Expected_Behavior: translate(key, 'ur') returns correct Urdu string for every new key_
    - _Preservation: All pre-existing UR entries are unchanged; translate(key, 'en') === key for all keys_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 3.1, 3.4, 3.5_

  - [ ] 3.2 Update `src/screens/Dashboard.tsx`
    - Add `import { useT } from '../app/i18n';`
    - Add `const t = useT();` inside `SafeToSpendHero`, `MonthFigures`, `RecentPanel`,
      `StatusLines`, `FirstRun`, and any sub-component that renders string literals.
    - Wrap all user-facing string literals with `t()`. Key strings include:
      "Left to spend", "This month", "In", "Out", "Kept", "Over", "Recent", "See all",
      "No transactions yet", "Start here", "Explore with sample data",
      "Import a CSV instead", "How this is worked out",
      "A budgeting calculation, not financial advice.", "Safe to spend",
      "Settle up", "Record them", "All bills", "All budgets", "Bill the month",
      dynamic parts like `${n} budgets on track` should use a translated base string where feasible.
    - Do NOT wrap Money values, dates, person names, or account names.
    - _Requirements: 2.1_

  - [ ] 3.3 Update `src/screens/Transactions.tsx`
    - Add `import { useT } from '../app/i18n';` and `const t = useT();` in `Transactions` and
      `TransactionDetail` components.
    - Wrap: "Search", "Filter", "All", "Out", "In", "Moved", "Category", "Account", "From", "To",
      "This month", "Show deleted", "Hiding nothing", "Clear", "Nothing matches",
      "No transactions yet", "Clear search", "Where the money moved", "Linked",
      "Refund of", "Refunded", "Edit", "Delete", "Restore",
      "Delete this transaction?", "This transaction is deleted", "Show", "Hide".
    - _Requirements: 2.2_

  - [ ] 3.4 Update `src/screens/Accounts.tsx`
    - Add `useT` import and `const t = useT();` in `Accounts`, `AccountGroup`, `AccountEditor`,
      `AccountDetail`, and `Reconcile` components.
    - Wrap all label strings, button labels, section headings, empty-state titles and bodies,
      and notice text. Key strings: "Net worth", "Own", "Owe", "Accounts", "Add account",
      "No accounts yet", "Add your first account", "Assets", "Liabilities", "Archived",
      "History", "Nothing recorded yet", "Reconcile", "Archive", "Unarchive", "Delete", "Edit",
      "Show older", "Balance today", "Amount currently owed", "Cancel", "Save changes",
      "Record adjustment", "Pocketa says", "You counted", "Adjustment".
    - _Requirements: 2.3_

  - [ ] 3.5 Update `src/screens/Budgets.tsx`
    - Add `useT` import and `const t = useT();` in `Budgets`, `BudgetCard`, and `BudgetEditor`.
    - Wrap: "Still available", "Budgeted", "Spent", "Budgets", "New budget", "No budgets yet",
      "Create a budget", "over", "left", "Transactions", "Edit", "Archive", "Restore",
      "Heading for", "Remaining", "Per remaining day", "Budget", "Period", "Monthly",
      "Weekly", "Yearly", "Custom dates", "Name", "Limit", "Categories", "Notes",
      "Warn me at", "At month end", "Restart fresh", "Carry unspent forward",
      "Move unspent to an account", "Transfer surplus into",
      "Create budget", "Save changes", "Cancel".
    - _Requirements: 2.4_

  - [ ] 3.6 Update `src/screens/Bills.tsx`
    - Add `useT` import and `const t = useT();` in `Bills`, `OccurrenceList`, `PayOccurrence`,
      and `RecurrenceEditor`.
    - Wrap: "Bills · a month", "Add a bill", "Overdue", "Coming up", "Settled", "Nothing due",
      "Record payment", "Change", "Skip", "Mark paid", "Reset to scheduled",
      "Due", "Recently settled", "All bills", "Every bill",
      "Amount paid", "Date paid", "Name", "Usual amount", "Paid from", "Paid into",
      "Into", "Category", "Repeats", "Monthly", "Weekly", "Yearly", "Daily",
      "Every N days", "Every", "On day of month", "On", "Starting", "Ending",
      "Schedule", "Remind me this many days ahead", "Record this automatically",
      "Notes", "Add bill", "Save changes", "Stop", "Resume", "Money out",
      "Money in", "Transfer", "Cancel".
    - _Requirements: 2.5_

  - [ ] 3.7 Update `src/screens/Goals.tsx`
    - Add `useT` import and `const t = useT();` in `Goals`, `GoalCard`, `GoalEditor`,
      and `MoveMoney`.
    - Wrap: "Set aside", "Target", "Reached", "Goals", "New goal", "No goals yet",
      "Create a goal", "Add money", "Take out", "Edit", "Each week", "Each month",
      "Still needed", "Fully funded.", "What are you saving for?", "Target amount",
      "Target date", "Planned monthly contribution", "Notes",
      "Create goal", "Save changes", "Cancel", "Archive",
      "From account", "Into account", "Date", "Amount", "Take money out".
    - _Requirements: 2.6_

  - [ ] 3.8 Update `src/screens/Debts.tsx`
    - Add `useT` import and `const t = useT();` in `Debts`, `PersonDebtRow`, `PersonEditor`,
      `RecordDebt`, and `DebtDetail`.
    - Wrap: "Net in your favour", "Net you owe", "Owed to you", "You owe", "People",
      "Add person", "Borrow", "Lend", "No people yet", "All square", "Show everyone",
      "They paid back", "Pay back", "History", "WhatsApp",
      "Add a person", "Name", "Phone or email", "Cancel", "Add person",
      "Lend money", "Record a repayment", "Borrow money", "Repay what you owe",
      "Person", "Amount", "Outstanding", "Paid from", "Received into",
      "Due back by", "Notes", "Record", "I lent money", "I borrowed money",
      "They paid me back", "I paid them back", "Owes you",
      "Total lent", "Total borrowed", "Repaid so far",
      "Net, in your favour", "Net, you owe", "Record a payment".
    - _Requirements: 2.7_

  - [ ] 3.9 Update `src/screens/Analytics.tsx`
    - Add `useT` import and `const t = useT();` in `Analytics` and `CategoryRow`.
    - Wrap: "Month", "Year", "Cash flow", "Net worth", "Daily", "Last 12 months",
      "Categories", "Merchants", "Largest", "Nothing to analyse yet",
      "A few weeks of activity and this page will show where the money goes.",
      "No spending in this period", "No merchants recorded",
      "Name the place when you record an expense and it ranks here.",
      "No expenses in this period", "Transactions", "visit", "visits", "last",
      "Not enough history to compare", "About the same as usual".
    - Note: "In", "Out", "Kept", "Overspent" are already in UR from Dashboard work — reuse.
    - _Requirements: 2.8_

  - [ ] 3.10 Update `src/screens/Settings.tsx`
    - Add `useT` import and `const t = useT();` in `SettingsScreen`, `SyncSection`,
      `AppearanceSection`, `MoneySection`, `SafeToSpendSection`, `CategoriesSection`,
      `DataSection`, `CategoryEditor`, `RatesEditor`, and `AboutSection`.
    - Wrap all tab labels, section headings, field labels, button labels, and notice text.
    - _Requirements: 2.9_

  - [ ] 3.11 Update `src/screens/Carpool.tsx`
    - Add `useT` import and `const t = useT();` in `CarpoolSetup`, `CarpoolBoard`,
      `QuickLog`, `LogTripSheet`, `RiderRow`, `TripRow`, and any other sub-component
      that renders string literals.
    - Wrap all user-facing strings listed in design.md.
    - _Requirements: 2.10_

  - [ ] 3.12 Update `src/screens/Me.tsx`
    - Add `useT` import and `const t = useT();` in `Me`.
    - Wrap: "Net worth", "None set", "On track", "at risk", "Nothing due",
      "due this week", "overdue", "All square", "None yet", "Show amounts", "Hide amounts".
    - Note: the `status` object builds strings dynamically — wrap the static parts only.
    - _Requirements: 2.11_

  - [ ] 3.13 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Urdu Rendering in All Screens
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 asserts that English literals are absent (or Urdu strings present) in Urdu mode.
    - When this test passes, it confirms the expected behavior is satisfied.
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

  - [ ] 3.14 Verify preservation tests still pass
    - **Property 2: Preservation** - English Rendering and Existing Translations Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2.
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [ ] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite (`npm test` or `npx vitest --run`).
  - Ensure all tests pass; ask the user if any questions arise.
  - Do a quick manual smoke-test: switch to Urdu, visit each screen, confirm primary headings
    appear in Urdu and amounts/dates are unchanged.
  - Switch back to English, confirm all strings revert cleanly.
