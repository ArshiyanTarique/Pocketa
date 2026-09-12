# Going live

Pocketa works with none of this. Offline, no account, everything except the
parts that involve other people. This document is only about turning those on.

There are four threads, in dependency order. Nothing later works until the
earlier ones are done.

| # | Thread | Needed for | Can it wait? |
|---|---|---|---|
| 4 | **Hosting** | installing it on a phone at all; a Play listing | **No.** Everything else can follow it. |
| 1 | A Supabase project | sync, accounts | Yes |
| 2 | The two SQL scripts | sync, carpool teams | Yes |
| 3 | Google sign-in | signing in without a browser warning | Yes — email sign-in works without it |

**Hosting is the one that cannot come last**, even though it is written last
here. A Play Store package is a wrapper around a live URL; it has nothing to
open without one. Section 6 covers phones.

Budget about 40 minutes for 1–3, and however long your host takes for 4.

---

## 1. Supabase project

1. Create a project at <https://supabase.com/dashboard>. Any region near your
   users; the free tier is enough for a household or a class.
2. **Project Settings → API keys**. Copy two values:
   - **Project URL** → `VITE_SUPABASE_URL`
   - the key under **Publishable key** → `VITE_SUPABASE_ANON_KEY`
3. In the project root:

   ```bash
   npm run connect-supabase -- https://your-project.supabase.co sb_publishable_...
   ```

   That writes `.env.local` **and** sets the same variables on the linked Netlify
   site, because both builds need them. It refuses a privileged key outright.

Supabase issues two shapes of key. Newer projects show **Publishable**
(`sb_publishable_…`) and **Secret** (`sb_secret_…`); older ones show **anon** and
**service_role** as JWTs. Use the browser-safe one of whichever pair you have —
the variable is still named `ANON_KEY` so that older projects keep working.

That key is meant to be public: it ships inside the browser bundle by design and
grants nothing on its own, because row-level security decides who may read what,
which is step 2. **A secret or service_role key must never go in this file** — it
bypasses every policy, and putting it here would hand it to every visitor.

> **Vite bakes these in at build time, not at run time.** Changing `.env.local`
> needs a restart of `npm run dev`, and a redeploy for a hosted build. Setting
> them on the server after the fact does nothing.

---

## 2. The two SQL scripts

Both are printed inside the app, so they can never drift from the code that
expects them. Run the app, open **Settings → Sync across devices → Set up
sync**, and use **Copy the ledger SQL** and **Copy the carpool SQL**.

In Supabase, open **SQL Editor → New query**, paste, and run. Both scripts are
safe to run more than once.

**The ledger script** creates one table, `ops`, with the simplest policy there
is: `auth.uid() = user_id`. Nobody can read anyone else's anything, and nothing
may be deleted — history is append-only.

**The carpool script** creates seven tables and is deliberately separate, because
carpooling needs the opposite of that policy in places: teammates must see each
other. Keeping the two apart means a rule written to let a team share a ride log
can never widen access to somebody's transactions.

Run only the ledger script if you want cross-device sync but no shared carpools.

### Confirm it took

In **Table Editor** you should see `ops`, plus `carpool_profiles`,
`carpool_contacts`, `carpool_teams`, `carpool_routes`, `team_memberships`,
`carpool_invites` and `carpool_rides`. Each should show **RLS enabled**. If any
says "RLS disabled", the script did not finish — re-run it and read the error.

Both scripts drop each policy before creating it, so re-running one updates the
rules rather than failing on "policy already exists".

---

## 3. Google sign-in

Email sign-in (a one-time link) works as soon as step 1 is done and needs nothing
here. Google needs a consent screen, and **until it is verified, anyone who is
not you sees a "Google has not verified this app" warning.**

1. **Google Cloud Console → APIs & Services → Credentials → Create OAuth client
   ID → Web application.**
2. Authorised redirect URI — take this from Supabase:
   **Authentication → Providers → Google**, which shows the exact callback URL
   for your project. It looks like
   `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Paste the resulting **Client ID** and **Client secret** back into that
   Supabase Google provider panel, and enable it.
4. **Authentication → URL Configuration** in Supabase:
   - **Site URL** — where the app actually lives (`http://localhost:5180` while
     developing, your real domain once deployed).
   - **Redirect URLs** — add both. Pocketa returns the browser to
     `origin + pathname`, so the bare origin with a trailing slash is what to
     allow: `http://localhost:5180/` and `https://your-domain/`.
5. **OAuth consent screen** — fill in the app name, support email and your
   domain, then publish it. Until Google verifies it, add the people who will use
   it as **test users**, which suppresses the warning for them.

If you skip this thread entirely, tell people to sign in with their email address
instead. It is a link in their inbox and it works identically.

---

## 4. Hosting

The build is static files. There is no server to run.

```bash
npm run build
```

The router is hash-based (`/#/carpool`), so **no rewrite rules, no SPA fallback
config, nothing host-specific is required.** Any static host serves `dist/`:
Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3, or a folder on a web server.

Two things must be true wherever it lands:

- **HTTPS.** A service worker will not register over plain HTTP, so without it
  the app does not install and does not work offline. `localhost` is exempt.
- **The environment variables are set in the host's build settings**, not just in
  your local `.env.local` — see the note in step 1.

Then close the loop: add the deployed URL to Supabase's **Site URL** and
**Redirect URLs** (step 3.4), or sign-in will bounce back with a redirect
mismatch.

Section 6 covers getting it onto a phone from here.

---

## 5. Prove it actually works

This is the part worth not skipping. Everything above is configuration that
silently half-works when it is wrong. These five checks fail loudly if something
is off, and they are exactly the things that have never been tested against a
live server.

You need two browser profiles — a normal window and a private one — signed in as
**two different accounts**. Call them A and B.

**1. Sync survives a round trip.**
In A, add a transaction. Open **Settings → Sync now** and wait for it to report
success. Now sign in as A on the *other* device or profile. The transaction
should appear. This proves push, pull, and the server sequence.

**2. One account cannot see another's ledger.**
Signed in as B, look at Transactions. It must be **empty**. If B can see A's
data, the ledger RLS policy did not apply — go back to step 2 and check that
`ops` shows RLS enabled. Nothing else matters until this passes.

**3. An invite works, and only through the link.**
As A, create a carpool, then **People → Create an invite link**. Paste that link
into B's browser. B should land on a page explaining what joining means, and join
only after pressing the button. This proves `redeem_carpool_invite` — the
function exists so a token can be *used* without any account being able to *list*
tokens.

**4. A pending request does not leak a phone number.**
Have B ask to join a *different* team of A's (Find a ride → request). While the
request is pending, neither side should see the other's number anywhere. After A
accepts, both numbers appear, along with a WhatsApp button.

This is the single most important check in the list. The rule exists so that
nobody can stand up a carpool that goes nowhere, wait for requests, and harvest
phone numbers from people who never got in the car. It is proven in the unit
tests as a function; this confirms the Postgres policy agrees.

**5. Both people see the same ride log.**
B logs a ride. A sees it, with B named as the person who logged it. The point of
the whole feature is that the driver is not the only one remembering.

If all five pass, the two unproven threads in `README.md` — the live transport
and the carpool policies — are closed.

---

## 6. Getting it onto a phone

There are two routes, and they are not equally good for the same things.

### Installing it directly — minutes, no fee, no review

Once step 4 is done, open the site in Chrome on Android and use **Install app**
(or Add to Home Screen). You get a real icon, a full-screen app with no browser
chrome, and offline use. This is not a shortcut or a lesser version — a TWA on
the Play Store runs the same code in the same engine.

Do this first, whatever else you decide. It costs nothing and you can be using
the app today.

### The Play Store — a wrapper around the same site

A Play listing is worth having for distribution: people find it by searching,
and it installs the way anything else does. The package is a **Trusted Web
Activity** — a thin Android app whose only job is to open your HTTPS URL
full-screen.

The consequence is the good part: **the web app is not bundled inside it.** Push
a fix to your host and every installed copy has it on next launch. A Play release
is only needed when the wrapper itself changes — the name, the icon, the
permissions — which is rare.

**This is why hosting cannot come last.** A TWA has nothing to open without a
live URL, and Android decides whether to hide the address bar by fetching
`/.well-known/assetlinks.json` from that exact domain. Step 4 is a prerequisite,
not a follow-up.

Supabase, the SQL and Google sign-in genuinely can wait — the app is fully
usable with none of them, and adding them later is a web deploy, not a Play
release.

#### Building the package

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://your-domain/manifest.webmanifest
bubblewrap build
```

It asks for a package name (`com.yourname.pocketa` — permanent, choose
carefully), generates a signing key, and produces `app-release-bundle.aab`.

**Back up the signing key and its password somewhere you will still have them in
five years.** Lose it and you cannot publish an update to that listing, ever;
the only way forward is a new listing and asking everyone to reinstall. This is
the single most common irreversible mistake in Android publishing.

Bubblewrap prints an `assetlinks.json`. Serve it at
`https://your-domain/.well-known/assetlinks.json` — put it in `public/.well-known/`
so the build copies it — or the app opens with a browser address bar across the
top.

#### What Google asks for

| | |
|---|---|
| **Developer account** | One-off 25 USD |
| **Closed testing first** | A personal account opened after 2023 must run a closed test with **12 testers opted in for 14 continuous days** before it can apply for production. An organisation account is exempt. Verify the current rule in the Play Console — this one changes. |
| **Privacy policy** | A public URL. Required even though the app collects nothing, and the policy should say exactly that. |
| **Data safety form** | Declare what is collected. Without Supabase: nothing leaves the device. With it: an email address for sign-in, the ledger, and a phone number if the carpool is used. |
| **Store listing** | Icon, feature graphic, screenshots, short and full description, content rating questionnaire. |

Plan on **two to three weeks** before the listing is public, almost all of it
waiting out the testing window rather than working. Which is the real argument
for installing it directly today and treating Play as the distribution channel
it is.

#### Once it is live

- **A web fix**: build, deploy to your host. Done. Every phone picks it up.
- **A wrapper change**: `bubblewrap update && bubblewrap build`, bump the version
  in `twa-manifest.json`, upload the new `.aab`.

---

## What still will not work, by design

- **Receipts do not sync.** They travel inside a backup file but not across
  devices; a photo taken on a phone will not appear on a laptop. That needs
  Supabase Storage, which is not built.
- **Route matching is straight-line, not road distance.** It answers "is this
  driver passing near me, going my way". It does not know about one-way streets,
  or a river between two points 200 metres apart.

---

## If something goes wrong

| Symptom | Cause |
|---|---|
| Settings says sync is unavailable | The env vars are missing, or the build predates them. Restart `npm run dev`, or redeploy. |
| Sign-in returns to a blank page, or errors on redirect | The URL is not in Supabase's **Redirect URLs**. It must match `origin + /` exactly, including the scheme. |
| A "not verified" warning on Google sign-in | Expected until the consent screen is verified. Add the person as a test user, or have them use email sign-in. |
| Sync reports a permission error | The SQL did not run, or ran against a different project than the one in `.env.local`. |
| B can see A's transactions | RLS is not enabled on `ops`. Re-run the ledger script and check the Table Editor. |
| The app does not install on a phone | Not served over HTTPS. |
