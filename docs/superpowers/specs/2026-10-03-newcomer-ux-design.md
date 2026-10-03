# Pocketa — newcomer UX redesign

Date: 2026-10-03. Scope: frontend only. Version number unchanged.

## Problem

The UI is visually finished but not learnable: seven of eleven screens sit
behind a "Me" tab, desktop navigation is icon-only until hovered, many
controls are icons without words, and forms rely on ~45 hint/description
strings to explain what controls do. A newcomer should understand the app
from its layout and labels, not from reading notes.

## Section A — Navigation & shell

Groups (routes unchanged, words changed):

| Group | Screens |
|---|---|
| daily (no heading) | Home · Activity · Carpool |
| Plan | Bills · Budgets · Goals |
| Money | Accounts · People (`/debts`) · Reports (`/analytics`) |
| — | Settings (pinned at bottom) |

- Desktop ≥ lg: fixed 13rem sidebar, always expanded, labels always visible,
  group headings, active item has filled background + accent bar. "Add"
  button at top with the word "Add". Top bar shows `Group › Screen`.
- Phone: 5 labelled tabs — Home · Activity · [Add] · Plan · More. Labels
  always visible. `/plan` and `/more` are list screens: icon, name, one-line
  purpose, live figure. `/me` redirects to `/more`.
- Top bar: "Sign in" is a labelled button when signed out; avatar + name when
  signed in. Theme switch moves to Settings › Appearance. Offline shows as a
  labelled chip.
- Sheets on phone get a visible "Back" affordance in the header.

## Section B — Screens

Rules:
1. Every control shows a word. Only `+`, `×`, `‹ ›` may stand alone, and
   only where space forbids a label.
2. One primary action per screen, sized `md`, at the list header and in the
   empty state.
3. Forms show essentials first; optional/advanced fields fold under a visible
   "More options". Hints are removed; labels fixed instead. Only data-guard
   feedback remains, shown inline at the moment it applies.
4. Expand-in-place rows use a down chevron and end with an explicit
   "Open X →" button.
5. Plain vocabulary, applied through `i18n.ts` (Urdu updated alongside).

Vocabulary: Left to spend → Safe to spend (+ "How?" link); In/Out/Kept →
Earned/Spent/Saved (Overspent); Moved → Transfers; Debts → People;
Analytics → Reports; Lend / Borrow → Lent · Borrowed; Type a sentence →
Quick type; Bills tabs → Due · Paid · All.

Per screen: Home hero labelled block; account cards plain; status lines per
rule 4; empty-state steps are buttons. Add sheet: Expense · Income · Transfer
+ "More ▾" (Lent, Borrowed, Refund); amount first; Budget/splits/shares/
currency/attachments under "More options". Activity: own "+ Add", visible
totals line. List screens: rules 2–3; "reconcile" → "Fix balance". Carpool:
month label between arrows, gear → "Settings", one-field first run.
Settings: tabs stay, essays and hints go, theme lands in Appearance.

## Testing

Existing vitest suite stays green. New test: every button/link rendered by
the Shell has visible text. Typecheck + tests after each phase; visual check
at 375 and 1280 on the dev server.
