# Pocketa — product redesign

Phases 1–3: what the product is, what is wrong with how it is presented, and
what it should become. Written before any code, so that the code follows it.

---

## 1. What this product actually is

Read from the source, not assumed.

**A personal ledger for one person, with two things bolted on that involve
other people.** The user is a university student in Karachi. He is given a
monthly budget, pays for things in rupees across cash, a bank account, a
wallet app and a card, and needs to know one thing most days: *how much can I
still spend?* Around that sit three recurring social-money situations:

1. **Friends owe him and he owes friends** — split bills, small loans, "I owe
   Hashim 240 for the soft drink".
2. **He drives friends to university** at a fixed rate per trip and bills
   them monthly. He forgets to note trips, so the app must make logging one
   tap.
3. **Carpool teams** — passengers can log their own rides, drivers mark
   routes, strangers can find a ride. This is the only multi-user surface.

Everything else — budgets, bills, goals, analytics, import/export, sync — is
in service of the core question or is housekeeping.

### The daily loop, in order of frequency

| Frequency | Task | Where it lives today |
|---|---|---|
| Several times a day | Record a spend (amount, what, from which account) | A 5-mode modal form, or a sentence parser behind a tab |
| Daily | Glance: how much is left? what's due? | Dashboard hero + 6 cards |
| Daily (weekdays) | Log who rode in the car | Carpool tab → Log a trip sheet |
| Weekly | Check who owes what; settle up | Debts screen, Carpool "Bill everyone" |
| Weekly | Review recent activity; fix a mistake | Activity list → detail sheet → edit sheet |
| Monthly | Pay bills, check budgets, bill the carpool | Bills, Budgets, Carpool |
| Rarely | Goals, analytics, accounts setup, settings, import | Their own screens |

**The design must be optimised for the top three rows.** Today the app treats
all ten screens as peers in the navigation and gives them the same visual
weight. That is the root of "clustered".

### Who else uses it

Friends who join a carpool team. They open the app for one reason — log a
ride, see what they owe, see the route — and may never record a personal
transaction. The current app shows them the full ledger dashboard first.

---

## 2. UX audit — what is wrong

### 2.1 Everything happens in a modal

**43 `<Sheet>`/`<Confirm>` instances across 16 files.** Every create, every
edit, every detail view, every confirmation is an overlay. The screens
themselves are just lists that open overlays.

Consequences:
- You lose your place. Tap a transaction → sheet. Tap Edit → the sheet closes
  and a *different* sheet opens. Save → back to the list, scrolled wherever.
- Nothing can be compared. You cannot see a transaction's detail next to the
  list it came from.
- On desktop, a 1000px-wide screen shows a list on the left and a dimmed
  overlay in the middle. The width is wasted.
- It feels generic: modal-over-list is the default output of every UI kit.

**Decision:** detail and edit become **in-context panels**, not overlays. On
desktop, a right-hand panel that slides in beside the list and keeps the list
interactive. On phones, a bottom sheet that rises from the tapped row. Only
destructive confirmations stay modal.

### 2.2 Every screen is the same screen

Ten screens, one layout: a hero number, then N white cards each with a header
and a list. Dashboard has 6 cards. Analytics has **9**. Settings has 7. The
eye cannot tell a screen's purpose from its shape.

**Decision:** each screen gets the *one* structure its task needs, and no
cards unless a card is genuinely a discrete object (an account, a person). A
list of transactions is a list, not a card containing a list.

### 2.3 The dashboard shows everything at once

Six cards, all permanently visible: Safe-to-spend, Net worth sparkline,
This-month reckoning, Where-it-went bars, Budgets, People, Coming-up bills,
Recent activity, Health. That is ~40 numbers on one screen for a question with
one answer.

Audit of each:
- **Safe to spend** — the answer. Keep, make it the only large thing.
- **Net worth + sparkline** — a weekly curiosity, not a daily need. Demote to a
  single line under the accounts; the chart lives in Analytics.
- **This month In/Out/Kept** — useful context for the hero. Keep as three
  small figures, not three cards.
- **Where it went (category bars)** — analysis, not status. Remove from the
  dashboard; it is the first thing on Analytics.
- **Budgets** — status only matters when one is at risk. Show only budgets
  that are over or projected over; otherwise one line "3 budgets on track".
- **People (owed/owing)** — only matters when non-zero. Show a single net line;
  tap for the breakdown.
- **Coming up (bills)** — matters in the next ~7 days. Show at most the next
  two, or one line "Nothing due this week".
- **Recent** — useful as an undo/verify surface. Keep 3 rows.
- **Health card** — a paragraph of prose restating the above. Remove entirely.

**Decision:** the dashboard becomes **one column of status lines**, most of
which are one line tall, expanding in place on tap. Only the hero number and
the accounts fan have visual mass.

### 2.4 Recording a spend is slow

The most frequent task is a 5-mode form: mode chips, amount, category picker
(search + 48-row scrolling list), account chips, split/share buttons, a
collapsed details section, sticky footer. It opens as a large modal.

- The mode chips (Expense / Income / Transfer / Debt / Refund) are shown every
  time, though 90% of entries are expenses.
- The category list is 48 rows; a category is chosen by scrolling or typing
  into a separate search box.
- The sentence parser is behind a tab, so its speed is undiscovered.

**Decision:** one entry surface. Type into a single field; it parses live (the
parser now does this well). Amount, merchant, category and account resolve as
you type and are shown as editable chips beneath. The structured form is what
you *tap into* from a chip when the parse is wrong, not a separate mode. Mode
is inferred (a person's name → debt, "from X to Y" → transfer) and shown as a
chip you can change. This collapses the tab, the mode chips and the form into
one flow.

### 2.5 The carpool is split down the middle

"My tally" and "Team & routes" are two tabs at the top of the Carpool screen,
with different data models underneath (local tally vs. shared network). To
the driver they are one thing: *my carpool*. The split is an implementation
seam leaking into the UI.

**Decision:** one Carpool screen. The team *is* the carpool. The header is
this month's total owed; the body is the riders (each with their tally and,
if the team is shared, whether they logged themselves); the route and the
invite live under a "Team" disclosure. Logging a ride is a one-tap row of
rider avatars at the top — not a sheet.

### 2.6 Bills, Budgets, Goals, Debts each have a hero + cards + a sheet

Same pattern four times. Each has a large display number at the top that
restates the sum of the list below it.

**Decision:** these are *lists with a summary line*, not dashboards. Summary
becomes a compact strip; each row expands in place to show its detail and
actions (pay this bill, add money to this goal), rather than opening a sheet.

### 2.7 Analytics is nine charts

Income vs expenses (12 months), net worth (12 months), day-by-day columns,
category bars, subcategory bars, five category sparklines, merchant list,
largest expenses, recurring cost. All visible, all at once.

For each: does the user need it *here*?
- Income vs expenses — yes, the headline comparison. Keep.
- Net worth chart — yes, but it is a second question. Behind a segmented
  control with the first.
- Day-by-day columns — rarely actionable. Fold into the period selector as a
  tap-to-reveal.
- Category and subcategory bars — **one** drill-down list, not two charts:
  tap a category to expand its subcategories in place.
- Category sparklines — merge into the same list as a per-row trend.
- Merchants and largest expenses — two lists that answer "where". One list,
  segmented: by category / by merchant / largest.
- Recurring cost — belongs on Bills.

Nine cards become **three questions**: *How did the period go?* (one chart,
switchable), *Where did it go?* (one drill-down list), *Is it changing?*
(trend, in the same list). Prose sentences like "Spending is 12% higher than
the month before" become a delta badge beside the number.

### 2.8 Settings is a scroll of seven cards

Fine for settings, but Import/Export/Backup/Audit/Storage are five sections
of one card, and the SQL setup panels are long. Group into tabs: Account ·
Appearance · Money · Categories · Data. Not urgent; last.

### 2.9 Navigation treats ten screens as equal

Sidebar/tab bar: Home, Activity, Carpool, Accounts, Budgets, Bills, Debts,
Goals, Analytics, Settings. On phone: three tabs + a "more" grid.

**Decision:** navigation follows the frequency table.
- **Phone:** Home · Activity · **+** · Carpool · Me. "Me" holds accounts,
  budgets, bills, goals, debts, analytics and settings as a single scrolling
  list of destinations with a status figure beside each (e.g. *Bills — 2 due*).
  That list is itself informative, which a "more" grid is not.
- **Desktop:** the same five, as a slim rail. Secondary destinations are
  reached from the Me screen or from the dashboard lines that link to them.

### 2.10 States

- **Loading:** two skeleton cards. Acceptable, but the app boots in <100ms
  from IndexedDB; the skeleton flashes. Replace with nothing until 150ms.
- **Empty first run:** rebuilt last pass; keep the shape, drop the paragraph.
- **Empty per-section:** icon + one line + one action. Mostly done; make it
  the rule.
- **Saving:** a toast with Undo. Good. Keep.
- **Errors:** a red Notice under the form. Fine.
- **Success of a sentence parse:** currently a "guessed" badge per field.
  Keep, but it should be visible *while typing*, not after.
- **Sync:** the badge in the header. Keep.

### 2.11 Motion

Today: a fade on route change, a rule that draws, cards that stagger in. All
decorative. Nothing communicates *change* — a number that updates snaps to
its new value, a filtered list re-renders, a panel appears from nowhere.

**Decision:** motion is reserved for four jobs:
1. **Continuity** — a row expands into its detail; the detail is visibly the
   same object (shared-element / layout animation).
2. **Change** — a figure that updates counts to its new value; a list that
   filters moves the survivors rather than repainting.
3. **Navigation** — the phone bar's active pill slides between items; the
   desktop panel slides in from the edge it belongs to.
4. **Feedback** — a save collapses the entry field and the new row lands in
   the list.
Everything else is static. Reduced-motion disables all four.

---

## 3. Design strategy, screen by screen

Conventions used below: **Primary** = what the eye must land on first.
**Secondary** = visible but quiet. **Hidden** = behind a tap, panel or
disclosure. **Removed** = gone from this screen.

### 3.1 Home

| | |
|---|---|
| Goal | *Can I spend, and is anything wrong?* in under two seconds. |
| Primary | Safe-to-spend figure. |
| Secondary | The accounts fan (tap → account). In / Out / Kept for the month. |
| Status lines | One line each, only when they have something to say: *Rent overdue 3 days* · *Food budget heading over* · *Hashim owes you 240* · *Carpool: 6 trips unbilled*. Tap expands the line in place; a second tap goes to the screen. |
| Hidden | The safe-to-spend arithmetic (tap "How?"). Budget detail. People breakdown. |
| Removed | Net worth chart, category bars, health card, bills list, recent list as cards. |
| Layout | Single column. Hero → fan → three figures → status lines → 3 recent rows. |
| Motion | Hero counts to its value on mount. Status lines expand with layout animation. |
| Phone | Identical; the fan is the horizontal element. |

### 3.2 Add (the entry surface)

| | |
|---|---|
| Goal | Record what happened in the fewest keystrokes. |
| Primary | One text field. Parses live. |
| Secondary | Result chips under it — amount · category · account · date · merchant · person — each tappable to change. Mode shown as a chip. |
| Hidden | The full structured form, reached by tapping any chip or "More". Splits and shares live inside it. |
| Removed | The Quick/Sentence tab. The five mode chips as a permanent row. |
| Layout | Phone: bottom sheet, field at top, chips, keyboard. Desktop: a panel from the right, same content. |
| Motion | Chips appear as the parse finds them. On save the sheet collapses and the new row is highlighted where it landed in Activity. |
| Edit | Opens the structured form directly, pre-filled, in the same panel. |

### 3.3 Activity

| | |
|---|---|
| Goal | Find a transaction; verify or fix it. |
| Primary | The list, grouped by day, dense. |
| Secondary | A single search field. Filters as chips that appear beneath it when tapped, not a collapsible form with four selects. |
| Detail | Tap a row → **desktop:** panel on the right, list stays; **phone:** the row expands in place to show postings, receipt and actions. No sheet. |
| Removed | The Spent/Earned/Net strip (it restates what the filter shows; move to a tooltip on the count). Day cards — days are headings, not cards. |
| Motion | Filter changes animate the list. Row → panel is a layout transition. |

### 3.4 Carpool

| | |
|---|---|
| Goal | Log today's trip in one tap; know who owes what. |
| Primary | A row of rider avatars at the top: tap the ones in the car, tap Log. Pre-selected to last time. |
| Secondary | This month's owed total. The rider list with tallies. |
| Hidden | Trip log (disclosure). Team: route, invite link, requests (disclosure, only if the team is shared). Settings (icon). |
| Removed | The My tally / Team tabs. The first-run paragraph. |
| Passengers | A passenger sees: the route, their own rides, what they owe, a "Log my ride" button. Not the driver's board. |
| Motion | Logging a trip: avatars pulse once, the tally figures count up. |

### 3.5 Bills · Budgets · Goals · Debts

One pattern, four uses: **a list whose rows expand**.

| | |
|---|---|
| Primary | The list. Rows show name, the one figure that matters, and a status colour. |
| Secondary | A summary strip above (one line, two or three figures). |
| Expanded row | Detail and actions in place: pay this bill / add to this goal / lend more / edit. |
| Removed | The hero display number. Separate cards per item. Sheets for detail. |
| Kept as sheets | Create/edit forms (they are forms). Destructive confirms. |

### 3.6 Accounts

| | |
|---|---|
| Primary | The fan, large. |
| Secondary | Net worth line. The list beneath as rows, not cards. |
| Detail | Desktop panel / phone expansion: balance, running-balance history, reconcile, edit, archive. |

### 3.7 Analytics

| | |
|---|---|
| Structure | Period selector → **one chart** (segmented: Cash flow · Net worth · Daily) → **one drill-down list** (segmented: Categories · Merchants · Largest) with a trend sparkline per row and subcategories expanding under a category. |
| Removed | Six of nine cards. Prose deltas become badges. Recurring cost → Bills. |

### 3.8 Me (phone) / secondary navigation

A list of destinations, each with a live figure: *Accounts — Rs 4.5L* ·
*Budgets — 1 at risk* · *Bills — 2 due* · *Goals — 34%* · *Debts — +240* ·
*Analytics* · *Settings*. The list is itself a status screen.

### 3.9 Settings

Tabs: Account · Appearance · Money · Categories · Data. Content unchanged.

---

## 4. Interaction inventory — what needs building

Derived from the strategy, not from a library list.

1. **Detail panel** — right panel on desktop, in-place expansion on phone,
   with a layout transition from the originating row. Used by Activity,
   Accounts, Bills, Budgets, Goals, Debts.
2. **Expanding row** — the phone form of (1); also the dashboard status lines.
3. **Live entry field with result chips** — the new Add.
4. **Animated figure** — any money value that changes in place.
5. **Animated list** — filtering, reordering, insertion after save.
6. **Segmented control with a sliding indicator** — analytics, filters.
7. **Rider avatar toggle row** — carpool logging.
8. **Phone bar with a sliding active pill.**
9. **Card fan** — exists; add drag on desktop and a position indicator.

Phase 4 researches the best open implementations for 1, 3, 4, 5 and 9.
Items 2, 6, 7 and 8 are small enough to build directly.

---

## 5. Rules (the system that supports the above)

- **Surfaces:** two levels only — the page, and a panel/sheet on it. No card
  inside a card. A list is a list.
- **Spacing:** 4px base; sections separated by 24px, rows by a hairline, never
  by a card border.
- **Type:** display face for the one primary figure/label per screen; body for
  everything else; mono for every number. Three sizes of body text, not eight.
- **Colour:** semantic only — jade in, rust out, gold for the primary action and
  the hero. Category colours appear as a 3px stripe or a dot, never as fills.
- **Icons:** one set (Lucide), one stroke weight, 16px in rows, 20px in navigation.
- **Hierarchy by size and position, not by boxes.**
- **Motion timing:** 180ms for state, 260ms for layout, 400ms for a count-up;
  one easing (`cubic-bezier(0.22, 1, 0.36, 1)`). Nothing loops.
- **States:** every list has an empty state of icon + line + action; every
  async action has a loading state on its button, not a spinner elsewhere.

---

## 6. Phase 5 log — what was built

| Screen | Change | Where |
|---|---|---|
| Foundations | `Sheet` gained a presentation axis (panel ≥1024px, sheet below, dialog for confirms); `ExpandingRow`; `Segmented` sliding pill; `SectionLabel`; `.disclose` | `src/ui/Sheet.tsx`, `src/ui/primitives.tsx`, `src/index.css` |
| Navigation | Five destinations (Home · Activity · + · Carpool · Me); Me is a status list | `src/app/Shell.tsx`, `src/screens/Me.tsx` |
| Home | Hero → fan → three figures → status lines that exist only when true → three recent rows | `src/screens/Dashboard.tsx` |
| Add | Kept as it was, by the user's choice: Quick form (mode chips, amount first, category, account chips, disclosed details) and a Type-a-sentence tab that reads live and hands off to the form. A single-field-with-chips version was built and reverted on 2026-09-09. | `src/components/QuickAdd.tsx` |
| Activity | Days are headings; filters disclosed; totals on the count | `src/screens/Transactions.tsx` |
| Carpool | Board + quick log row; team behind a heading | `src/screens/Carpool.tsx` |
| Bills · Budgets · Goals · Debts | Summary strip + expanding-row list; Debts is one row per person with the net | `src/screens/{Bills,Budgets,Goals,Debts}.tsx` |
| Analytics | Period → one chart (Cash flow · Net worth · Daily) → one list (Categories · Merchants · Largest); subcategories expand under a category; recurring cost lives in Bills | `src/screens/Analytics.tsx` |
| Settings | Five tabs, tab in the URL (`/settings/data`) | `src/screens/Settings.tsx` |

### Phase 6 — motion (built)

One dependency, `motion`. `MotionConfig` at the root sets the single easing
and `reducedMotion="user"`.

| Where | What |
|---|---|
| `Money` | Counts from the old value to the new one over 400ms when a figure changes in place. On by default at `display`/`xl` sizes and opt-in below; rows never mount the effect. |
| Activity | `AnimatePresence` + `layout="position"` on day sections and rows: filtering slides survivors and fades the rest. |
| Phone bar | One `layoutId` pill springs between destinations. |
| Account fan | Mouse drag-to-scroll with snap suspended while dragging; position dots that centre a card on tap. |
| Panels, rows, chips | CSS: `panel-in`, `.disclose`, `.fade-in`, `.count-in`, `.stagger`. |

Not done, deliberately: shared-element row→panel morphs. The panel opens
beside the list on desktop and the row stays highlighted; a morph would be
decoration on top of that.

Remaining: a contrast pass in both themes at 375px and 1280px once the
build tools are available again, then build and deploy.
