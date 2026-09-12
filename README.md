# Pocketa

A calm, accurate command centre for your money.

Local-first, offline-capable, and built around one idea: **every figure the app
shows is summed from your transactions, never stored separately.** A balance
cannot drift from the ledger behind it, because it has no independent existence.

```bash
npm install
npm run dev
```

Then open the app and choose **Explore with sample data** to see three months of
a plausible ledger without typing anything.

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (PWA, service worker, icons) |
| `npm run preview` | Serve the production build |
| `npm test` | Run the test suite |
| `npm run typecheck` | Type-check without emitting |

---

## The idea

Most expense trackers store a `transactions` table with a `type` column, then
*remember* to exclude transfers from spending totals. Miss that filter once — in
one report, one export, one dashboard tile — and the app quietly double-counts.

Pocketa uses a **postings model** instead. A transaction is a header plus N
postings, each `(account, signed amount)`, with one hard invariant:

> **A transaction's postings sum to exactly zero.**

Categories are modelled as accounts internally (you never see this). Money is
only ever *moved*, never created or destroyed. Which means:

| Requirement | How it is met |
|---|---|
| Transfers are not expenses | `Bank −20,000` · `Cash +20,000` — no category is touched, so no query anywhere can see it as spending. An absence, not a filter. |
| Card payments are not expenses | Structurally identical to a transfer, because it *is* one. |
| Debt movements are not income | `Cash −4,000` · `Receivable:Sara +4,000` — an asset changes form. Net worth is flat across lending and repayment. |
| Goal contributions are not expenses | A transfer into an earmarked account. |
| Splits total the parent exactly | Guaranteed by the zero-sum invariant, not by validation code. |
| Refunds net correctly | `Cash +800` · `Groceries −800`, linked to the original. Net expense falls out of plain summation. |
| Shared bills do not inflate spending | Other people's shares post to receivables, not to categories. |
| Balances never drift | `balance(account) = SUM(postings)`. Never stored. |

None of those is a special case in the code. They are consequences of the
invariant. `src/core/ledger.ts` is where it lives, and `src/core/ledger.test.ts`
asserts each one against the worked examples.

## Carpool: the tally

A fixed rate per person per trip, counted as it happens rather than remembered
at month end.

**A trip is a tally mark, not a transaction.** Logging that someone rode with
you moves no money — it records an obligation that has not been billed. Nothing
enters the ledger until you bill the month, at which point each rider's total
becomes one receivable and the trips it covered are stamped so they can never be
charged twice.

That separation is deliberate. Accruing a ride as income the moment it happens
would put money you have not been handed into every monthly figure, which is
exactly what the rest of the app exists not to do.

| | |
|---|---|
| **Logging** | One tap. The rider list defaults to whoever was in the car last time. |
| **Not forgetting** | The screen surfaces weekdays with nothing recorded and offers a button per day. Weekends are ignored. |
| **Rates** | A carpool rate, optionally overridden per rider. The rate is **frozen onto each trip**, so raising it in October never re-prices September. |
| **Billing** | Shows every rider's total for confirmation first. Then `Recv:Sara +2,000` · `Transport −2,000`. |
| **Collecting** | The receivable appears under Debts and settles like any other. |

Money collected defaults to **reducing a spending category** — it is reimbursing
fuel you already paid for, so your real transport cost is what you see. It can
be recorded as income instead, in the carpool settings.

## Carpool teams, routes and discovery

The tally above is one person's private count. The second half of the feature is
the carpool itself: a driver, the passengers, and the ride log they all share.

**Two roles, one account type.** A person is a driver in the teams they created
and a passenger in the ones they joined; the same account is both. There is no
separate sign-up, no mode to switch.

| | |
|---|---|
| **Getting people in** | The driver creates an invite link and sends it however they like. The link lands on a page that states what joining means — and joins nobody until they press the button. |
| **Or the other way round** | Someone who found the carpool by searching asks the driver, with an optional note. The driver accepts or declines. |
| **Logging** | Any active member can log a ride, not just the driver. This is the point: the person who remembers is rarely the one at the wheel. |
| **Seeing** | The whole team sees every logged ride and what each rider owes. Nobody has a private version of the count. |
| **Rates** | Frozen onto each ride when it is logged, exactly as in the personal tally. |

### Routes and finding a ride

A driver marks the route as an ordered list of points — start, any stops, and
the destination — and how far off it they will detour to pick someone up. There
is no map, and that is deliberate: tiles need a network, an API key and a
licence, none of which suit an app whose premise is working offline. A place is
captured the three ways people actually know one — where they are standing, a
place they saved before, or coordinates pasted out of a maps app — and the route
is drawn back as a plain polyline, which is enough to spot a stop entered in the
wrong order.

Someone looking for a ride enters where they start and where they are going.
A route matches only if **both** points fall within the driver's stated reach,
**and** the drop-off is further along the route than the pickup — a search from
the university to home does not match the morning run to the university. Results
are ordered by total walking distance plus a penalty for how far the detour
takes the driver off their own path.

When nothing matches, the screen says which of those conditions failed, rather
than showing an empty list.

### Phone numbers

A number is collected once, at profile setup, and it is visible **only between
people who share an active team**.

Not to someone who has merely requested to join, and not on a search result.
That is the whole point of the rule: if a pending request exposed numbers,
anyone could stand up a carpool that goes nowhere, wait for requests, and
harvest phone numbers from people who never got in the car. Joining is what
grants it, and leaving takes it away.

Where a number is visible, so is a WhatsApp button that opens a chat with it.

Numbers live in their own table with their own policies, separate from profiles,
so a mistake in a profile policy cannot spill them.

### Where this runs

The carpool network is **shared by nature** — it means nothing without other
people — so unlike the ledger it needs a server to be more than single-user.
Without one it still works: teams, routes and rides are stored locally and the
screens behave identically, you are simply the only person in them.

The tables are separate from the ledger's, with their own row-level security.
Nothing in the carpool schema can widen access to anyone's transactions. The SQL
is in **Settings → Sync**, alongside the ledger's.

## The database contract

The postings model above says what a *correct* transaction looks like. This says
what happens when one is written — the four properties, and where each is
enforced. `src/store/acid.test.ts` proves each by breaking it on purpose.

### Atomicity

Every mutation writes two things: the entity, and the op describing it. They go
in **one IndexedDB transaction**, through a single `commit()` in the store.

That matters because the op is the unit of both history and sync. A tab closed
between two separate writes would leave a transaction that never appears in its
own audit trail and never reaches another device — present locally, invisible
everywhere else. An import is one transaction for the whole batch, and a carpool
billing is one for the new receivable accounts, the charges, the trip stamps and
the settlement together, because a half-billed month is worse than an unbilled
one.

### Consistency

The zero-sum invariant is checked before anything is written, and the tests
re-read from storage to confirm it held. No balance is ever stored — only the
postings it is summed from, so a stored figure cannot drift from its ledger. An
amount that is not a whole minor unit is rejected rather than rounded.

### Isolation

IndexedDB serialises transactions on the same tables, so concurrent mutations
cannot interleave or lose an update. Twenty-five writes issued at once produce
twenty-five rows, twenty-five ops and twenty-five distinct sequence numbers.
Boot is guarded separately: a namespace is seeded exactly once no matter how
many times `init` is called concurrently, which is what React's double-invoked
effects do in development.

### Durability

**The write lands before the screen changes.** Memory is updated only after the
transaction commits, so a failed write — quota exhausted, storage evicted —
cannot leave a saved-looking figure on screen that is not on disk.

Beyond that, browsers may evict a site's data under storage pressure. Pocketa
asks once, at the first moment there is a ledger worth keeping, for the origin
to be marked persistent; **Settings → Storage** shows the answer and offers the
request again. The op log is loaded back in canonical order rather than
whatever order IndexedDB returns keys in.

The one permanent delete in the app — emptying the bin of deleted transactions —
writes a record of itself, so a gap in the ledger is always explained.

## The schema

Two databases, with different jobs and different guarantees.

### Locally: IndexedDB, and the constraints it does not have

IndexedDB has primary keys and unique indexes. It has no foreign keys, no check
constraints, no `ON DELETE`, and no way to declare that a number must be a whole
one. Everything a relational database would refuse to store, it stores happily.

So the constraints live in three places, and each is enforced rather than
assumed.

**In the shape of the data.** A transaction is a header plus postings that sum
to zero. That is not validated after the fact; it is what the builders in
`core/ledger.ts` construct, and nothing else can construct a transaction.

**In the store, declared.** Where IndexedDB *can* enforce something, it does.
`overrides` carries `&[recurrenceId+dueDate]` — a unique index, not a decorative
one, because "one record per bill occurrence" is a rule the app depends on. A
bad merge or a hand-edited backup that tries to make the same bill both paid and
skipped is rejected by the browser with a `ConstraintError`.

**In `data/integrity.ts`, at the two doors.** Data arrives without passing
through the builders in exactly two places — a restored backup, and ops pulled
from another device — and both are checked before anything is written. A file
that does not add up is refused with the reason. A dangling reference is mended
rather than refused, because a receipt pointing at a transaction that is not in
the file is worth clearing, not worth losing a whole restore over. Nothing is
ever invented: a repair may clear a reference or drop a row that points at
nothing, and may never fabricate an account or alter a figure.

The same check is on **Settings → Check this ledger**, so the answer can be had
on demand rather than trusted.

Deletion is the other thing IndexedDB will not do for you. Almost nothing here
is ever deleted — transactions are voided and kept — but emptying the bin is a
real delete, so it clears what pointed at those rows in the same transaction:
refunds that referenced them, bills marked paid by them, and the receipts that
would otherwise sit unreachable against the storage cap forever.

### The index set says how the data is read

This app loads each table into memory once and filters there, because a personal
ledger is small enough that this is the right trade. An index would therefore
have been maintained on every write and read by nothing. Version 3 of the schema
removed the ones nobody queried — the multi-entry index on tags was the worst of
them, one entry per tag per transaction — leaving a date range, the bin, the
duplicate check an import runs, a transaction's receipts, and the two questions
the op log is actually asked.

### On the server: Postgres, where the constraints are real

The carpool tables use what Postgres offers, rather than trusting the client:
foreign keys with `ON DELETE CASCADE` throughout, `CHECK` on every enum column
and every range, `UNIQUE (team_id, user_id)` so a person cannot be on a team
twice, `UNIQUE (team_id)` on routes because one route per team is what the app
means, and a check that a route's path is a list of at least two points. An
active membership must say when it began, because that membership is what grants
ride logging and phone visibility.

The `ops` table is append-only, and now in both directions. A delete policy
alone left that half true — nothing could remove a row, but an update could
blank one and leave its id in place. A trigger now rejects any update that
changes what happened, while still letting a client repeat a push whose
acknowledgement was lost.

`src/data/schema.test.ts` reads both scripts as text and checks the things that
are invisible until they matter: that **every** table has row-level security
enabled, that every policy can be re-run without error, that every reference to
a user cascades, and that the profile table contains no phone column.

## Architecture

```
React + TypeScript PWA  (static build, installable, works offline)
├── src/core/        the financial engine — no React, no I/O, fully tested
│   ├── money.ts        integer minor units; no float ever touches money
│   ├── dates.ts        timezone-naive calendar dates on integer Y/M/D
│   ├── ledger.ts       the postings model, builders and the invariant
│   ├── projections.ts  balances, net worth, budgets — all derived
│   ├── recurrence.ts   bills; templates never mutated by one occurrence
│   ├── safeToSpend.ts  a transparent calculation that shows its working
│   ├── carpool.ts      trip tallying; touches money only at settlement
│   └── nlp.ts          local, deterministic natural-language entry
├── src/data/        persistence, audit log, import/export, receipts, sync adapter
├── src/store/       in-memory state, written through to IndexedDB
├── src/ui/          design system
└── src/screens/     the app surfaces, one file each
```

**The whole ledger lives in memory.** A personal finance dataset is small enough
that loading it entirely makes every projection instant and every screen usable
with no network. IndexedDB is written through on each mutation, so the memory
copy and the durable copy never diverge.

### The operation log

Every mutation appends an immutable op alongside the entity write. Ops are never
edited or deleted; a correction is a new op. That single mechanism delivers
three things at once:

- **Audit history.** Changing Rs. 4,000 to Rs. 3,500 records both values, with a
  timestamp, rather than overwriting the past.
- **Reversible deletion.** Deleting voids a transaction; the row stays and can be
  restored.
- **Sync.** Ops are idempotent (keyed by id) and totally ordered (by a
  server-assigned sequence), so two devices converge deterministically.

## Money and dates

Two decisions do most of the correctness work:

**Amounts are integer minor units.** `1234` means Rs. 12.34. No floating-point
value ever enters the money path, so `0.1 + 0.2` problems cannot arise. Splits
use largest-remainder allocation, so Rs. 10.00 three ways is `333 + 333 + 334` —
exactly 1000, with the rounding dust distributed rather than invented.

**Calendar dates are timezone-naive strings.** A transaction happened on a *day*,
not at a UTC instant. All date arithmetic runs on integer year/month/day, never
by constructing a `Date` and adding milliseconds — which is how month-end and
DST bugs get in. A bill on the 31st lands on 28 February and returns to 31 March,
without drifting.

## Safe to Spend

```
  liquid balances (cash, bank, e-wallet; excludes investments, goals, credit)
− unpaid bills falling due inside the horizon
− goal contributions still planned this month
− outstanding credit-card balances
= safe to spend
```

The dashboard renders this as a **reckoning strip** — the figures in a column
with a rule above the total, the way a page is hand-totalled. The headline
number always equals the visible breakdown; a test asserts exactly that. It is a
transparent budgeting calculation, not financial advice, and the app says so.

## Sync (optional)

Pocketa works fully offline with no account. Signing in adds durability and
cross-device continuity.

**[DEPLOYMENT.md](DEPLOYMENT.md) is the step-by-step version of this**, including
Google sign-in, hosting, and the five checks that prove the server half actually
works. What follows is the short form.

1. Create a Supabase project.
2. Run the SQL shown in **Settings → Sync**. There are two scripts: the ledger's
   (one append-only table with row-level security, so an account can only ever
   read its own rows) and the carpool's (separate tables with their own rules —
   nothing there can widen access to transactions). The carpool one is only
   needed if you want teams shared across people.
3. Set the environment variables and rebuild:

```bash
npm run connect-supabase -- https://your-project.supabase.co sb_publishable_...
```

Use the **Publishable key** (older projects call it **anon**). It is public by
design; a secret or `service_role` key must never be used here, and the script
refuses one.

Without these the app runs exactly as before and Settings says plainly that sync
is unavailable, rather than failing quietly. The Supabase SDK is loaded on
demand, so a user who never signs in never downloads it.

## Assumptions made

Documented rather than silent:

| # | Assumption |
|---|---|
| A1 | Sign-in is optional; the app is fully functional anonymous and offline. |
| A2 | Amounts are integer minor units throughout. Non-negotiable. |
| A3 | Default currency is PKR, but nothing is hard-coded to it. |
| A4 | Exchange rates are frozen onto each transaction at entry, never retro-applied, so historical reports do not change when a rate moves. |
| A5 | Natural-language entry uses a local deterministic parser — offline, free, predictable. An LLM can be slotted in behind the same interface. |
| A6 | One active account per device session. |
| A7 | Attachments are stored as blobs in IndexedDB, size-capped. |
| A8 | Timestamps are UTC; calendar dates are timezone-naive. |
| A9 | A carpool phone number is shared with an active team and nobody else — not with pending requests, not in search results. Leaving a team withdraws it. |
| A10 | Route matching uses straight-line geometry, not road distance. It answers "passing near me, in my direction". |

## Testing

```bash
npm test
```

520 tests across 21 files. The suite is organised so requirements are checkable
against it rather than against the implementation:

- `money.test.ts` — parsing, formatting, allocation, conversion
- `dates.test.ts` — leap years, month-end clamping, timezone independence
- `ledger.test.ts` — every canonical posting shape from the specification
- `projections.test.ts` — balances, net worth, budgets, Safe-to-Spend
- `recurrence.test.ts` — schedule generation, overrides, missed occurrences
- `carpool.test.ts` — tallying, frozen rates, never billing a trip twice
- `geo.test.ts` — distance, projection, point-to-segment, direction along a path
- `carpoolMatch.test.ts` — route matching, including that a reversed journey does not match
- `carpoolNetwork.test.ts` — who may log, who may see, and who may not have a phone number
- `xlsx.test.ts` — a real workbook built byte-by-byte in the test, including deflate
- `attachments.test.ts` — size caps, type rules, base64 round-trip
- `ErrorBoundary.test.tsx` — that a crash is caught and recoverable
- `useIncremental.test.ts` — list windowing, including with no IntersectionObserver
- `backup.test.ts` — compression, and that older plain backups still open
- `sync.test.ts` — two-device convergence against an in-memory server
- `nlp.test.ts` — the parser, including that it only ever proposes
- `useStore.test.ts` — persistence, audit trail, restart, backup, isolation
- `acid.test.ts` — atomicity, consistency, isolation and durability, each proven by breaking it
- `integrity.test.ts` — the foreign keys, cycles and uniqueness IndexedDB cannot enforce
- `schema.test.ts` — the server scripts: row-level security on every table, and policies that can be re-run
- `edgeCases.test.ts` — the specification's edge-case checklist, item by item

## What is deliberately not here

- **No automatic AI writes.** A parsed sentence is always shown for confirmation
  before anything is recorded.
- **No guessed exchange rates.** A missing rate is an error, not an estimate.
- **No hard deletes of history.** Categories and accounts archive; transactions
  void. Restoring a backup is the only destructive action, and it requires
  typing a confirmation phrase.
- **No projection from too little data.** A budget will not warn about
  overspending from one day's pace, because a linear projection that early is
  noise.
- **No carpool accrual.** A logged trip is not income until it is billed.

## Receipts

Photos and PDFs attach to a transaction and stay on the device — nothing is
uploaded. Two limits are enforced rather than hoped for: **6 MB per file** and
**250 MB in total**, because an app that silently fills a phone until the
browser starts evicting data would be losing the user's records.

Settings shows how much room the browser is actually giving Pocketa, and offers
to request persistent storage so the origin is not evicted under pressure.
Receipts travel inside a backup as base64; there is a smaller "without receipts"
export for when the ledger alone is enough. Backups are gzipped — a 20,000
transaction ledger went from 21 MB to 0.65 MB — and restore detects the format
by content, so a plain backup from an earlier version still opens.

## Importing

| Format | Support |
|---|---|
| **CSV** | Full. Commas, semicolons or tabs; quoted fields; column mapping; duplicate detection. |
| **.xlsx** | Full, read natively. Shared strings, inline strings, and **date cells resolved through the style table** — otherwise a date imports as "46266". |
| **.xls** (old binary) | Refused with a clear message telling you to re-save as .xlsx or CSV. |

The .xlsx reader is about 4 KB and lazy-loaded, built on the platform's own
`DecompressionStream` rather than a spreadsheet library.

## At scale

Measured with 20,000 transactions in IndexedDB — roughly five years of heavy use.

| | Before | After |
|---|---|---|
| Transactions screen | hung the tab (~760,000 characters of DOM) | 290 ms, 657 nodes |
| Backup file | 21 MB | 0.65 MB |

Long lists render a window at a time and grow on scroll, with a button as the
fallback. Rows stay in the DOM once shown rather than being virtualised, so
find-in-page, text selection and screen readers keep working. Totals above a
list are always computed from the whole filtered set, never from the rendered
window — paging never changes a figure.

## When something goes wrong

An error boundary wraps both the shell and each screen, so a broken screen does
not take navigation with it. It says plainly that the data is safe, shows the
actual fault, and offers retry, reload and copy-the-details — no button in that
dialog destroys anything.

## Sync: what is proven, and what is not

The unit of sync is the operation, not the entity. Ops are immutable and keyed
by id, so pushing is an upsert and pulling is a set union — there is no merge
conflict to resolve, and two devices converge by ordering the union on the
sequence the server assigned.

**Proven**, against an in-memory server modelling the real schema (primary key
on `id`, `bigserial` that is not reissued on a conflicting upsert, row-level
security scoping reads to one account):

- two devices converge after both edited offline, in either sync order
- a concurrent amendment to the same transaction keeps **both** sides in the
  audit history rather than silently dropping one
- a push whose acknowledgement was lost is safe to repeat — no duplicate row,
  and the original sequence is retained
- one account never sees another's ops
- pulling pages rather than fetching an unbounded history
- a server or network failure leaves local ops queued, not lost

**Not proven.** The transport itself has never run against a live Postgres. The
tests assert that the adapter is called correctly and that the merge rules hold;
they cannot assert that the real upsert and RLS policies behave as modelled. The
carpool schema is in the same position: its visibility rules are proven as
functions, against the same fixtures the UI uses, but the Postgres policies that
mirror them have not been exercised on a server. To close both, point a build at
a Supabase project:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Known limits

Deliberate, not oversights:

- **Receipts are device-local.** They travel inside a backup, but they do not
  sync — a photo taken on a phone will not appear on a laptop. Carrying them
  across devices needs Supabase Storage, which is not built.
- **Google sign-in needs your domain registered** on the OAuth consent screen
  before anyone but you can use it without a warning.
- **The old binary .xls format** is refused rather than guessed at.
- **Carpool discovery is single-user until a server exists.** Locally you can
  create teams, mark routes and log rides, but there is nobody else's route to
  find. Searching says so rather than pretending the world is empty.
- **Route matching is straight-line, not road distance.** It answers "is this
  driver passing near me, in my direction", which is the question being asked;
  it does not know about one-way streets or a river between two points 200
  metres apart.
