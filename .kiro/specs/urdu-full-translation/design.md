# Urdu Full Translation — Bugfix Design

## Overview

The Urdu translation covers only two files (`Shell.tsx`, `QuickAdd.tsx`). All other screens render
hardcoded English strings that bypass the `t()` translation function. This fix wraps every
user-facing string in all remaining screen files with `t()` and expands the `UR` dictionary in
`src/app/i18n.ts` with correct Urdu translations for every new key.

The fix is purely additive: no existing dictionary entries are modified, the translation lookup
falls back to English for any missing key, and the `en` path of `translate()` returns the key
unchanged, so English users see zero difference.

---

## Glossary

- **Bug_Condition (C)**: A screen is rendered while `settings.language === 'ur'` AND that screen
  contains at least one user-facing string that is not passed through `t()`.
- **Property (P)**: When the bug condition holds, every user-facing string visible to the user
  SHALL be the Urdu translation, not the original English literal.
- **Preservation**: English rendering, existing Urdu translations in `Shell.tsx` /
  `QuickAdd.tsx`, and the English fallback for missing keys must all remain exactly as before.
- **`t(key)`**: The function returned by `useT()` — calls `translate(key, lang)`.
- **`UR`**: The `Record<string, string>` constant in `src/app/i18n.ts` that maps English keys to
  Urdu strings.
- **Hardcoded string**: A string literal inside JSX or a prop that is rendered directly without
  being wrapped in `t()`.

---

## Bug Details

### Bug Condition

The bug manifests whenever a screen other than `Shell` or `QuickAdd` is viewed in Urdu mode.
None of those screens call `useT()`, so every visible string literal is English regardless of
the language setting.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { lang: string; screen: string }
  OUTPUT: boolean

  RETURN input.lang = 'ur'
         AND input.screen IN [
           'Dashboard', 'Transactions', 'Accounts', 'Budgets',
           'Bills', 'Goals', 'Debts', 'Analytics', 'Settings',
           'Carpool', 'Me'
         ]
         AND screenHasUntranslatedStrings(input.screen)
END FUNCTION
```

### Examples

- User switches to Urdu → opens Dashboard → sees "Left to spend", "This month", "Recent" in
  English. **Expected:** "خرچ کرنے کے لیے باقی", "اس مہینے", "حالیہ".
- User switches to Urdu → opens Debts → sees "People", "Lend", "Borrow" in English.
  **Expected:** "لوگ", "قرض دیں", "قرض لیں".
- User switches to Urdu → opens Analytics → sees "Cash flow", "Net worth" in English.
  **Expected:** "نقد بہاؤ", "خالص مالیت".
- User switches to Urdu → opens Settings → sees "Theme", "Hide amounts" in English.
  **Expected:** "تھیم", "رقم چھپائیں" (already in UR — must not regress).

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- English rendering is unchanged — `translate(key, 'en')` returns `key` for all inputs.
- Existing Urdu entries in the `UR` dictionary are not modified or removed; all existing
  translations in `Shell.tsx` and `QuickAdd.tsx` continue to work.
- The English fallback (`UR[key] ?? key`) continues to return the English literal whenever a key
  is absent from `UR`.
- Dynamic strings (person names, transaction amounts, dates, account names) are NOT passed through
  `t()` — they are never dictionary keys.

**Scope:**
All inputs where `lang === 'en'`, or where the screen is `Shell` or `QuickAdd`, are completely
unaffected by this fix.

---

## Hypothesized Root Cause

1. **Missing `useT()` hook calls**: The screen components (`Dashboard`, `Transactions`, etc.) were
   built without calling `const t = useT()`, so there is no translator available in scope.

2. **Missing UR dictionary entries**: Even if `t()` were called, many keys would fall back to
   English because the `UR` dictionary only covers ~80 keys (navigation + QuickAdd + a few
   dashboard/settings labels) while the full app UI has several hundred user-facing strings.

3. **No lint/test enforcement**: Nothing in the CI pipeline checks that JSX string literals are
   wrapped in `t()`, so the gap grew silently as new features were added.

---

## Correctness Properties

Property 1: Bug Condition — Urdu Rendering in All Screens

_For any_ render where `settings.language === 'ur'` and the screen is one of Dashboard,
Transactions, Accounts, Budgets, Bills, Goals, Debts, Analytics, Settings, Carpool, or Me, the
fixed code SHALL display every user-facing string literal in Urdu (via a `t()` call that resolves
to a non-empty `UR` entry).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11**

Property 2: Preservation — English Rendering and Existing Translations Unchanged

_For any_ render where `settings.language === 'en'`, or where the screen is Shell or QuickAdd,
or where a key already existed in `UR` before this fix, the fixed code SHALL produce exactly the
same output as the original code — no string changes, no regressions.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

---

## Fix Implementation

### Changes Required

**File 1:** `src/app/i18n.ts`

- Add ~200 new key–value pairs to the `UR` dictionary covering all strings found in the 11
  screens listed below. Keys are the exact English string used as the argument to `t()`.

**Files 2–12:** One per affected screen

For each screen file, the changes follow the same pattern:
1. Add `import { useT } from '../app/i18n';` (if not already present).
2. Inside the top-level component function (and any sub-component that renders strings), add
   `const t = useT();`.
3. Replace every hardcoded user-facing string literal `"Foo"` in JSX / props with `{t('Foo')}` /
   `t('Foo')`.
4. Do **not** wrap dynamic values (interpolated names, amounts, dates).

**Specific changes per screen:**

**`src/screens/Dashboard.tsx`**
- Wrap: "Left to spend", "This month", "In", "Out", "Kept", "Over", "Recent", "See all",
  "No transactions yet", "Net worth", "Start here", "Add an account", "What is in it today",
  "Record a spend", "Amount, category, done", "Add your bills",
  "So they are reserved before you spend", "Explore with sample data",
  "Import a CSV instead", "How this is worked out", "A budgeting calculation, not financial advice",
  "Safe to spend", "Settle up", "Record them", "All bills", "All budgets", "over", "left",
  "budget on track", "budgets on track", "owe you", "is owed", "owe you", "you owe",
  "overdue", "unbilled", "Bill the month".

**`src/screens/Transactions.tsx`**
- Wrap: "Search", "Filter", "All", "Out", "In", "Moved", "Category", "Account", "From", "To",
  "This month", "Show deleted", "Hiding nothing", "Clear", "Nothing matches",
  "No transactions yet", "Clear search", "Where the money moved", "History", "Show", "Hide",
  "Linked", "Refund of", "Refunded", "Net cost after refunds", "Edit", "Delete", "Restore",
  "Delete this transaction?", "This transaction is deleted", "edited".

**`src/screens/Accounts.tsx`**
- Wrap: "Net worth", "Own", "Owe", "Accounts", "Add account", "No accounts yet",
  "Add your first account", "Assets", "Liabilities", "Archived", "History",
  "Nothing recorded yet", "Transactions in this account will appear here.",
  "Reconcile", "Archive", "Unarchive", "Delete", "Edit", "Show older",
  "Balance today", "Amount currently owed", "What kind of account?", "Name",
  "Currency", "Institution", "Credit limit", "Last 4 digits",
  "Statement closes on", "Payment due on", "Day of the month", "Notes",
  "Exclude from net worth", "Add an account", "Save changes", "Cancel",
  "Record adjustment", "Pocketa says", "You counted", "Adjustment",
  "Balance reconciled", "Already matching".

**`src/screens/Budgets.tsx`**
- Wrap: "Still available", "Budgeted", "Spent", "Budgets", "New budget", "No budgets yet",
  "Create a budget", "days left", "over", "left", "Transactions", "Edit", "Archive",
  "Restore", "Heading for", "Remaining", "Per remaining day", "Budget",
  "Name", "Limit", "Period", "Monthly", "Weekly", "Yearly", "Custom dates",
  "Categories", "Nothing selected means this budget covers all spending.",
  "Warn me at", "At month end", "Restart fresh", "Carry unspent forward",
  "Move unspent to an account", "Transfer surplus into", "Notes",
  "Create budget", "Save changes", "Cancel", "Archive".

**`src/screens/Bills.tsx`**
- Wrap: "Bills · a month", "Add a bill", "Overdue", "Coming up", "Settled", "Nothing due",
  "Record payment", "Change", "Skip", "Mark paid", "Reset to scheduled",
  "Due", "Recently settled", "All bills", "Every bill", "active",
  "Amount paid", "The usual amount is", "Only this occurrence changes", "Date paid",
  "Name", "Usual amount", "Paid from", "Paid into", "Into", "Category",
  "Repeats", "Monthly", "Weekly", "Yearly", "Daily", "Every N days",
  "Every", "On day of month", "On", "Starting", "Ending", "Schedule",
  "Remind me this many days ahead", "Record this automatically", "Notes",
  "Add bill", "Save changes", "Stop", "Resume", "Money out", "Money in",
  "Transfer", "Cancel".

**`src/screens/Goals.tsx`**
- Wrap: "Set aside", "Target", "Reached", "Goals", "New goal", "No goals yet",
  "Create a goal", "Add money", "Take out", "Edit", "Archive",
  "Each week", "Each month", "Still needed", "months", "Fully funded.",
  "Withdraw it whenever you need it.", "Target date passed with",
  "to go.", "What are you saving for?", "Target amount", "Target date",
  "Planned monthly contribution", "Reserved from your safe-to-spend until you have made it each month.",
  "Pocketa works out what you would need to put aside.",
  "Notes", "Create goal", "Save changes", "Cancel",
  "From account", "Into account", "Date", "Amount",
  "Moving money to a goal is a transfer, not spending — your expenses for the month are unaffected.",
  "Add money", "Take money out".

**`src/screens/Debts.tsx`**
- Wrap: "Net in your favour", "Net you owe", "Owed to you", "You owe", "People",
  "Add person", "Borrow", "Lend", "No people yet",
  "People you lend to, borrow from, or split with.",
  "All square", "Nothing outstanding with", "Show everyone",
  "They paid back", "Pay back", "History", "WhatsApp",
  "Hide", "Show", "settled", "settled person", "settled people",
  "Add a person", "Someone you lend to, borrow from, or split bills with.",
  "Name", "Phone or email", "Just for your reference", "Cancel", "Add person",
  "Lend money", "Record a repayment", "Borrow money", "Repay what you owe",
  "Person", "Amount", "Outstanding", "Paid from", "Received into",
  "Due back by", "Notes", "Record", "Owes you", "You owe",
  "They owe you", "You owe them", "Net, in your favour", "Net, you owe",
  "Total lent", "Total borrowed", "Repaid so far", "Record a payment",
  "I lent money", "I borrowed money", "They paid me back", "I paid them back",
  "Choose a person", "Choose an account".

**`src/screens/Analytics.tsx`**
- Wrap: "Month", "Year", "In", "Out", "Kept", "Overspent", "Cash flow", "Net worth", "Daily",
  "Last 12 months", "Categories", "Merchants", "Largest",
  "Nothing to analyse yet", "A few weeks of activity and this page will show where the money goes.",
  "No spending in this period", "No merchants recorded",
  "Name the place when you record an expense and it ranks here.",
  "No expenses in this period", "Transactions", "visit", "visits",
  "last", "Not enough history to compare", "Above its six-month average by",
  "Below its six-month average by", "About the same as usual",
  "transaction", "transactions", "Home".

**`src/screens/Settings.tsx`**
- Wrap all tab labels, section headings, field labels, button labels, and notice text, including:
  "Account", "Appearance", "Money", "Categories", "Data",
  "Your account", "Sync across devices", "Signed in",
  "Sign out", "Sync now", "Continue with Google", "Send link",
  "Theme", "System", "Light", "Dark", "Accent color",
  "Text size", "Normal", "Large", "Very Large",
  "Display density", "Comfortable", "Compact",
  "Hide amounts", "Week starts on", "Monday", "Sunday",
  "Language / زبان", "Base currency", "Exchange rates", "Edit",
  "Look ahead", "days", "Spending", "Income",
  "Add", "Name", "Sits under", "Top level", "Colour",
  "Bring data in", "Take data out", "Backup",
  "Import from CSV", "CSV", "Spreadsheet", "PDF report",
  "Save a backup", "Restore a backup",
  "Save a smaller backup without receipts",
  "Start over", "Erase everything on this device",
  "Run the check", "Everything adds up", "Storage",
  "Check this ledger", "About",
  "Add category", "Save changes", "Cancel", "Archive", "Restore",
  "Save rates", "Record this automatically".

**`src/screens/Carpool.tsx`**
- Wrap: "Stop counting from memory", "Set up the carpool",
  "What is this run called?", "Rate per person, per trip",
  "Money collected goes against", "No trip logged today",
  "Some days are still unlogged", "Log today", "Another day",
  "Today · who is in the car?", "Nobody rode",
  "Owed", "Trips", "Riders", "Each",
  "Log a trip", "Bill everyone", "Add a rider",
  "Who owes what", "No riders yet",
  "Add the people who ride with you and their trips will start counting.",
  "No trips this month", "Log a trip and the totals appear here.",
  "Trip log", "lifetime", "Nothing logged this month",
  "Left", "Billed", "Change", "Log",
  "Edit trip", "Log a trip", "Who was in the car?",
  "Tap to toggle. Starts with whoever rode last time.",
  "Save trip", "Delete", "Skip",
  "Name", "Notes", "Cancel",
  "Who rode with you?", "Date", "Note".

**`src/screens/Me.tsx`**
- Wrap: "Net worth", "None set", "On track", "at risk", "Nothing due",
  "due this week", "overdue", "All square", "None yet",
  "Show amounts", "Hide amounts".

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first confirm the bug exists on unfixed code
(strings remain English in Urdu mode), then verify the fix produces Urdu strings and preserves
English rendering.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm
or refute the root cause analysis.

**Test Plan**: For each affected screen component, render it inside a store where
`settings.language = 'ur'` and assert that at least one known hardcoded string (e.g. "Left to
spend" for Dashboard) is NOT present in the rendered output — or conversely that the Urdu
equivalent IS present.

**Test Cases**:
1. **Dashboard Urdu test**: Render `<Dashboard />` with `lang='ur'`, assert "Left to spend" is absent (will FAIL on unfixed code, i.e. "Left to spend" is still present).
2. **Accounts Urdu test**: Render `<Accounts />` with `lang='ur'`, assert "Net worth" label is absent (will FAIL — "Net worth" still rendered in English).
3. **Budgets Urdu test**: Render `<Budgets />` with `lang='ur'`, assert "Still available" is absent (will FAIL).
4. **Debts Urdu test**: Render `<Debts />` with `lang='ur'`, assert "People" heading is absent (will FAIL).

**Expected Counterexamples**:
- The English string is found in the rendered output even though `lang='ur'` — confirms no `t()`
  wrapping and no `useT()` call in these components.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the
expected Urdu output.

**Pseudocode:**
```
FOR ALL screen WHERE isBugCondition({ lang: 'ur', screen }) DO
  rendered := render(screen, { language: 'ur' })
  ASSERT urduStringIsPresent(rendered, knownKey)
  ASSERT englishLiteralIsAbsent(rendered, knownKey)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (English mode, or
screens already covered), the fixed code produces the same output as the original.

**Pseudocode:**
```
FOR ALL screen WHERE NOT isBugCondition({ lang: 'en', screen }) DO
  ASSERT render_original(screen, { language: 'en' })
       = render_fixed(screen, { language: 'en' })
END FOR
```

**Testing Approach**: Property-based testing generates many (`lang`, `screen`, `key`) triples
automatically and verifies the invariant across the full space of keys and screens.

**Test Cases**:
1. **English preservation**: For every newly-wrapped key, `translate(key, 'en') === key`.
2. **Existing UR entry preservation**: All ~80 keys that existed in `UR` before this fix still
   return the same Urdu string after the fix.
3. **Fallback preservation**: Any key not in `UR` still returns the key itself (English fallback).

### Unit Tests

- Each screen: render with `lang='ur'`, spot-check 2–3 representative translated strings.
- `translate()`: verify new UR entries return correct Urdu strings.
- `translate()`: verify all pre-existing entries are unchanged.

### Property-Based Tests

- Generate all keys in `UR` and verify `translate(key, 'en') === key` (English is always identity).
- Generate all keys in `UR` and verify `translate(key, 'ur') !== key` (every UR entry is different
  from its English key — i.e. it is actually translated).
- Generate all keys used as `t()` arguments across the 11 screens and verify each has a non-empty
  entry in `UR` (no missing translations after the fix).

### Integration Tests

- Switch language to Urdu in Settings → navigate to each screen → confirm at least the primary
  heading appears in Urdu.
- Switch language back to English → confirm all strings revert to English.
- Reload the page with `language: 'ur'` persisted in the store → confirm Urdu still renders.
