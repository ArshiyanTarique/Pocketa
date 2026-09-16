# Bugfix Requirements Document

## Introduction

The Urdu translation is only partially working. `useT()` / `t()` is called in `Shell.tsx` and
`QuickAdd.tsx`, so navigation labels and the add-transaction form translate correctly. Every other
screen — Dashboard, Transactions, Accounts, Budgets, Bills, Goals, Debts, Analytics, Settings,
Carpool, and Me — renders hardcoded English strings that are never passed through `t()`. When a
user switches the app to Urdu, those screens remain entirely in English, making the translation
feature non-functional for the vast majority of the UI.

The fix has two parts:
1. Wrap every user-facing string in every screen file with `t()`.
2. Expand the Urdu (`UR`) dictionary in `src/app/i18n.ts` to cover all newly-wrapped keys with
   correct Urdu translations.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
    Dashboard.tsx (e.g. "Left to spend", "This month", "In", "Out", "Kept", "Recent", "See all",
    "No transactions yet", "Start here", "Explore with sample data").

1.2 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
    Transactions.tsx (e.g. "Search", "Filter", "All", "Out", "In", "Moved", "Category", "Account",
    "From", "To", "This month", "Show deleted", "Clear", "Nothing matches", "No transactions yet",
    "Edit", "Delete", "Restore", "Where the money moved", "History", "Show", "Hide").

1.3 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
    Accounts.tsx (e.g. "Net worth", "Own", "Owe", "Accounts", "Add account", "No accounts yet",
    "Assets", "Liabilities", "Archived", "History", "Reconcile", "Archive", "Unarchive", "Delete",
    "Edit", "Nothing recorded yet", "Show older").

1.4 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
    Budgets.tsx (e.g. "Still available", "Budgeted", "Spent", "Budgets", "New budget",
    "No budgets yet", "days left", "over", "left", "Transactions", "Edit", "Archive",
    "Restore", "Create a budget").

1.5 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
    Bills.tsx (e.g. "Bills · a month", "Due", "Recently settled", "All bills", "Nothing due",
    "Overdue", "Coming up", "Settled", "Record payment", "Change", "Skip", "Mark paid",
    "Reset to scheduled", "Add a bill", "Stop", "Resume", "Save changes").

1.6 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
    Goals.tsx (e.g. "Set aside", "Target", "Reached", "Goals", "New goal", "No goals yet",
    "Add money", "Take out", "Edit", "Archive", "Each week", "Each month", "Still needed",
    "Fully funded", "Create a goal").

1.7 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
    Debts.tsx (e.g. "Net in your favour", "Net you owe", "Owed to you", "You owe", "People",
    "Add person", "Borrow", "Lend", "No people yet", "All square", "They paid back", "Pay back",
    "History", "WhatsApp", "Add a person", "Record a repayment", "Lend money", "Borrow money",
    "Person", "Amount", "Outstanding", "Paid from", "Received into", "Due back by", "Record").

1.8 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
    Analytics.tsx (e.g. "Month", "Year", "In", "Out", "Kept", "Overspent", "Cash flow",
    "Net worth", "Daily", "Last 12 months", "Categories", "Merchants", "Largest",
    "Nothing to analyse yet", "No spending in this period", "Transactions", "visits", "visit").

1.9 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
    Settings.tsx (e.g. "Account", "Appearance", "Money", "Categories", "Data", "Your account",
    "Sync across devices", "Theme", "System", "Light", "Dark", "Accent color", "Text size",
    "Normal", "Large", "Very Large", "Display density", "Comfortable", "Compact", "Hide amounts",
    "Week starts on", "Monday", "Sunday", "Language", "Base currency", "Exchange rates",
    "Look ahead", "days", "Spending", "Income", "Add", "Name", "Top level", "Colour",
    "Bring data in", "Take data out", "Backup", "Save a backup", "Restore a backup",
    "Import from CSV", "CSV", "Spreadsheet", "PDF report", "Start over",
    "Erase everything on this device", "Run the check", "Everything adds up", "Storage",
    "Sign out", "Sync now", "Continue with Google", "Send link").

1.10 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
     Carpool.tsx (e.g. "Stop counting from memory", "Set up the carpool", "No trip logged today",
     "Log today", "Owed", "Trips", "Riders", "Each", "Log a trip", "Bill everyone", "Add a rider",
     "Who owes what", "No riders yet", "No trips this month", "Trip log", "Log", "Change",
     "Another day", "Today · who is in the car?", "Nobody rode", "Billed", "Edit trip",
     "Log a trip", "Who was in the car?", "Save trip", "Delete", "Skip",
     "What is this run called?", "Rate per person, per trip").

1.11 WHEN the user sets the language to Urdu THEN the system displays hardcoded English strings in
     Me.tsx (e.g. "Net worth", "None set", "On track", "at risk", "Nothing due", "due this week",
     "overdue", "All square", "None yet").

---

### Expected Behavior (Correct)

2.1 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
    in Dashboard.tsx in Urdu, by passing each string through `t()` and providing the matching Urdu
    translation in the `UR` dictionary in `src/app/i18n.ts`.

2.2 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
    in Transactions.tsx in Urdu, by passing each string through `t()` and providing the matching
    Urdu translation.

2.3 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
    in Accounts.tsx in Urdu, by passing each string through `t()` and providing the matching Urdu
    translation.

2.4 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
    in Budgets.tsx in Urdu, by passing each string through `t()` and providing the matching Urdu
    translation.

2.5 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
    in Bills.tsx in Urdu, by passing each string through `t()` and providing the matching Urdu
    translation.

2.6 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
    in Goals.tsx in Urdu, by passing each string through `t()` and providing the matching Urdu
    translation.

2.7 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
    in Debts.tsx in Urdu, by passing each string through `t()` and providing the matching Urdu
    translation.

2.8 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
    in Analytics.tsx in Urdu, by passing each string through `t()` and providing the matching Urdu
    translation.

2.9 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
    in Settings.tsx in Urdu, by passing each string through `t()` and providing the matching Urdu
    translation.

2.10 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
     in Carpool.tsx in Urdu, by passing each string through `t()` and providing the matching Urdu
     translation.

2.11 WHEN the user sets the language to Urdu THEN the system SHALL display all user-facing strings
     in Me.tsx in Urdu, by passing each string through `t()` and providing the matching Urdu
     translation.

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the language is set to English THEN the system SHALL CONTINUE TO display all strings in
    English in every screen (the `t()` function returns the key unchanged for `lang === 'en'`).

3.2 WHEN Shell.tsx is rendered with the language set to Urdu THEN the system SHALL CONTINUE TO
    display navigation labels in Urdu exactly as before (existing translations must not regress).

3.3 WHEN QuickAdd.tsx is rendered with the language set to Urdu THEN the system SHALL CONTINUE TO
    display the add-transaction form labels in Urdu exactly as before.

3.4 WHEN a translation key that already exists in the `UR` dictionary is used THEN the system
    SHALL CONTINUE TO return the same Urdu string as before (no existing entry may be changed
    or deleted).

3.5 WHEN a translation key is missing from the `UR` dictionary THEN the system SHALL CONTINUE TO
    fall back to the English key so nothing breaks during partial rollout.
