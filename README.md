# Huat Huat 1.1.0

A manual, shared ledger for couples. A static website, with the ledger stored in
your own Supabase project.

Nothing to install and nothing to build: `web/` is plain HTML, CSS and
JavaScript that any static host will serve.

---

## Read this first: where the source went

The original source tree does not exist. What survived is the shipped 1.0.0
desktop build — the **minified** renderer bundle and the Electron main process.
There is no sourcemap and no `src/`.

So this project is built the only way it could be:

- `vendor/renderer-bundle.original.js` — the recovered bundle, untouched.
- `tools/patch-renderer.mjs` — every change to that bundle, as an explicit
  find/replace with a reason attached. It regenerates `web/assets/`.
- `web/bridge.js`, `web/ui.js`, `web/app.css` — new code, written normally.

**Never hand-edit `web/assets/`.** It is generated. Change
`tools/patch-renderer.mjs` and re-run it. All 34 edits assert they matched the
expected number of times, so the build fails loudly rather than shipping a
half-patched bundle.

```bash
npm run patch
```

---

## Setting up Supabase

### 1. Create a project

Any Supabase account works, and you can move to a different one later — see
[Switching Supabase accounts](#switching-supabase-accounts).

### 2. Create the table

Dashboard → **SQL Editor** → New query → paste all of
[`supabase/schema.sql`](supabase/schema.sql) → Run.

It creates one `ledgers` table, a trigger so the **server** stamps
`updated_at`, four row-level-security policies, and a realtime subscription. The
last statement prints `rls_enabled` and `policy_count` — expect `true` and `4`.

Row level security is the part that matters. The anon key in the page is
publishable and identifies the project; it grants nothing on its own. The
policies are what stop one signed-in user reading another's ledger. Without
them that table is readable by anyone holding that key.

### 3. Turn on sign-in

**Authentication → Providers**:

- **Email** — on by default, and enough to use the site. "Email me a sign-in
  link" sends a real magic link through Supabase.
- **Google** — optional. Needs a Google OAuth client, see below.

### 4. Point the site at your project

**Project Settings → API**, then fill in [`web/config.js`](web/config.js):

```js
window.HUAT_CONFIG = {
  supabaseUrl: 'https://abcdefgh.supabase.co',
  supabaseAnonKey: 'eyJhbG...',
};
```

Use the **anon** / publishable key. Never the `service_role` key — that one
bypasses RLS entirely and would hand every ledger to anyone who views source.

Until this is filled in the site still runs; it says there is no account storage
and offers to keep the ledger in the browser instead.

---

## Google sign-in

> **Your existing OAuth client will not work here.** The one set up for the
> desktop app is a **Desktop app** client. Supabase performs the OAuth exchange
> on its own servers, so it needs a **Web application** client. The client type
> cannot be changed after creation — make a new one.

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs &
   Services → Credentials → Create credentials → OAuth client ID → Web
   application**.
2. Under **Authorised redirect URIs** add, exactly:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
   Supabase shows this string on the Google provider page — copy it from there.
3. Paste the client ID and secret into Supabase under **Authentication →
   Providers → Google**, and enable it.
4. In Supabase under **Authentication → URL Configuration**, set **Site URL** to
   where the site is hosted, and add it to **Redirect URLs**. Getting this wrong
   is the usual reason sign-in completes and then lands on the wrong page.

The secret lives in Supabase's dashboard, not in this repository — which is a
real improvement on the desktop build, where it had to ship on disk.

---

## Switching Supabase accounts

Nothing here is tied to a particular Supabase account or project. To move:

1. Create a project on the other account.
2. Run `supabase/schema.sql` there.
3. Re-do the auth setup above for the new project ref.
4. Replace the two values in `web/config.js`.

Two things do **not** come with you:

- **The data.** Each project has its own database. Copy a ledger across by
  running `select state from ledgers` on the old project and inserting that JSON
  into the new one against the new `user_id`.
- **The accounts.** `auth.users` is per project, so everyone signs in again. Any
  magic-link or Google identity is re-created on first sign-in.

---

## Hosting it

The site is static. Any of these work, free tier included — publish the `web/`
directory as the site root:

| Host | How |
|---|---|
| Netlify | drag `web/` onto the dashboard, or point it at the repo with publish directory `App/web` |
| Vercel | import the repo, framework "Other", output directory `App/web` |
| Cloudflare Pages | build command none, output directory `App/web` |
| GitHub Pages | push `web/` to a `gh-pages` branch |
| Supabase Storage | create a public bucket and upload `web/` |

Whichever you pick, set the deployed URL as **Site URL** in Supabase, or sign-in
will redirect somewhere unexpected.

Locally:

```bash
npm run dev      # patches the bundle, serves web/ on http://localhost:5599
```

---

## What changed from the desktop app

### The demo ledger is gone

1.0.0 was a prototype full of invented data — two named people, their banks,
hundreds of transactions — with "today" frozen at `2026-09-18`.

- The storage key moved to `.v2`, so the old demo ledger is never read, and the
  v1 key is deleted on first load.
- A new account starts with no transactions, accounts, goals, holdings or
  check-ins, and keeps nine starter category groups with everything at zero.
- Dates are real. Because `today` is saved *inside* the ledger, it is re-dated on
  every load; crossing into a new month creates that month and carries the plan
  forward.

### Nothing implies a partner until there is one

The prototype was hardwired for a named couple, so a solo ledger showed a second
person with zeros beside them. A ledger now starts with one person and the joint
pot. The partner slot is created only when someone adds a partner — from
**Edit** in the sidebar.

Until then: no second avatar, no per-person lens in the top bar, no partner
column in the recurring breakdown or the spending legend, no "X wrote 0", and
goal funding offers only the one honest option.

### Profile editing

**Edit**, beside Sign out, opens a profile editor: your name, the email shown on
the ledger, your colour, and adding, renaming or removing a partner.

### Sign-in is real

1.0.0's "Continue with Google" was a mock that signed you in as a demo
character, and "Email me a sign-in link" never sent an email. Both now go
through Supabase and do what they say.

### The narrow layout

The bundle collapses its sidebar below 900px, but the `<nav>` inside carries an
inline `display:grid` that no stylesheet rule can override without `!important`
— so it stayed a tall vertical column beside the logo, while everything marked
`only-wide`, including the account block and sign-out, vanished. Both are fixed
in `web/app.css`, along with two width bugs that gave the page a horizontal
scrollbar at tablet size.

### The logo

Both logos were the 🐈 emoji, which Windows draws as an orange tabby — nothing
like the app's own black cat. They now use the artwork.

---

## How sync behaves

| | |
|---|---|
| Where | one row per user in `public.ledgers`, as a single JSON document |
| Who can read it | only that user, enforced by RLS |
| On sign-in | pulls the stored ledger; a new account is seeded from this browser |
| On change | pushes 2.5s after you stop typing |
| From elsewhere | Supabase realtime pushes the change; a write from this browser is ignored by its device id |
| Offline | the ledger keeps working and says "saved in this browser" |

**The honest limit:** this is document sync, not operational merge. Conflicts
resolve last-write-wins on the server's clock. Two browsers editing the same
minute keep the later save and lose the earlier one. For a ledger two people
type into a few times a day that is a fair trade; for heavy simultaneous editing
it is not.

---

## Layout

```
web/                        the site — deploy this directory
  index.html                load order here is deliberate, see the comment
  config.js                 YOUR Supabase url + anon key  (gitignored)
  config.example.js         template
  ui.js                     status pill, overlays, profile editor
  bridge.js                 fresh state, partner logic, auth, sync
  app.css                   corrections layered over the bundle's stylesheet
  huat-cat.png              logo
  vendor/supabase.js        supabase-js, vendored so there is no CDN dependency
  assets/                   GENERATED by tools/patch-renderer.mjs
supabase/
  schema.sql                table, trigger, RLS policies, realtime
tools/
  patch-renderer.mjs        every bundle edit, with reasons
  serve-web.mjs             static server for local testing
vendor/
  renderer-bundle.original.js   recovered 1.0.0 bundle — the source of truth
_desktop-backup/            the retired Electron app, kept until you say otherwise
```

---

## Known rough edges

- **Partner is a label, not a second account.** Both people share one login.
  Real multi-account sharing needs a ledger/membership model and RLS policies to
  match; the "Share this ledger" screen is still the prototype's and its invite
  link goes nowhere.
- **Fonts need the network.** The two typefaces come from Google Fonts. Offline,
  the site falls back to system fonts and looks noticeably different.
- **Custom Supabase domain needs a CSP edit.** `index.html` allows
  `https://*.supabase.co` and `wss://*.supabase.co`. Behind your own domain, add
  that origin or the browser blocks every request silently.
- **Dead demo data remains in the bundle.** The seed arrays survive as
  unreferenced constants — nothing reads them, but they cost about 10 KB.
- **`_desktop-backup/` still holds the Google client secret** from the desktop
  build, in `electron/google-credentials.json`. Delete the folder once you are
  happy with the web version, and consider rotating that secret.
