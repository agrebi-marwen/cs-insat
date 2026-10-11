# THE TIME PORTAL — deployable_platform

A gamified monthly coding-challenge platform built and maintained by the **IEEE CS INSAT Student Branch Chapter**.
Users solve monthly coding challenges (submit GitHub/GitLab repos or attach a source file for Competitive Programming challenges), earn Energy Points (EP), climb a 7-tier rank ladder, follow learning roadmaps, and watch workshop videos — all inside a 16-bit / 8-bit "temporal" design system (see `DESIGN.md`).

---

## 1. Stack

| Layer | Technology |
| :--- | :--- |
| Frontend | Vanilla HTML5 + CSS3 + ES6 JS, no framework, no build step |
| CP submission | Users attach a source file (`.c/.cpp/.py/.java`); language detected from the extension |
| Backend / Database | Supabase (PostgreSQL + Auth + Row Level Security), queried in-browser via `supabase-js` UMD |
| Judge | Piston API (`https://emkc.org/api/v2/piston/execute` + `/runtimes`), public + optional `PISTON_API_KEY` |
| Serverless | Vercel Node.js functions in `api/` (ESM) |
| Local dev | `python -m http.server 3000` (static only; `api/` requires Vercel) |

---

## 2. Repository Layout

```
/
├── index.html               Public landing page
├── account/                 login.html, signup.html
├── dashboard/               dashboard, challenges, submit, submissions,
│                            roadmaps, roadmap, learn, workshops
├── admin/                   admin.html (Command Center console)
├── api/                     Vercel serverless functions (ESM)
│   ├── _lib/                shared: supabase.js, http.js, rateLimit.js, piston.js
│   ├── config.js            serves Supabase creds + admin password from env
│   ├── authLogin.js / authSignup.js
│   ├── adminCheck.js        admin role + password verification
│   ├── rateLimit.js         auth attempt throttling
│   └── cpSubmit.js          the CP judge (maxDuration 60s)
├── assets/
│   ├── js/                  shared: config, common, security, theme, galaxy-bg,
│   │                        cursor-lighting, creative, perf-mode, api-cache
│   ├── js/pages/            one file per page (admin, submit, dashboard, ...)
│   └── css/                 global.css + per-context css
├── db/                      *.sql schema + RLS, run in Supabase SQL Editor
│   ├── tables.sql / challenges.sql / roadmaps.sql / roadmap_nodes.sql
│   ├── workshops.sql
│   ├── cp_problems.sql      CP judge tables, bucket, policies (NEW)
│   └── cp_multiple_submissions.sql  CP retry policy and idempotent scoring
├── vercel.json              headers/CSP + function maxDuration
├── DESIGN.md                design system spec
├── PROJECT_RESUME.md        feature-by-feature documentation
└── SECURITY_AUDIT.md / RLS.md
```

---

## 3. How to Run

### Local (frontend only)
```bash
python -m http.server 3000
# open http://localhost:3000
```
`assets/js/config.js` detects `localhost:3000` and calls `http://localhost:3000/api/config`.
Serverless endpoints (`api/*`) need Vercel — local runs without them will fail auth/admin features.

### Deploy
```bash
vercel
```

### Required environment variables (Vercel)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — **required only for `api/cpSubmit.js`** (judge writes + private test-file reads)
- `ADMIN_PASSWORD` (used by `api/adminCheck.js`)
- `PISTON_API_KEY` — optional; appended as the `Authorization` header on Piston calls when set
- `PISTON_BASE_URL` — optional Piston API base URL; use `http://localhost:2000/api/v2` for local Piston development

Database schema lives in `db/*.sql`; apply new migrations in the Supabase SQL Editor.

---

## 4. Conventions & gotchas (read before editing)

- **No build step.** Pages are plain HTML that load `theme.js` early, then `config.js` → `common.js` → `security.js`/`api-cache.js`/effect scripts → `pages/<page>.js` (all `defer`). Page scripts bootstrap with `initApp(initPageFn)`; every page calls `requireSession()` to enforce the auth wall.
- **API functions are ESM.** `api/**` uses `import`/`export default`. `node --check` on a `.js` file needs an ESM parse — copy it to `.mjs` in temp first, e.g. `Copy-Item x.js $env:TEMP\opencode\x.mjs` then `node --check`. Files in `api/_lib/` are never deployed as routes (Vercel ignores `_` dirs).
- **Content Security Policy (`vercel.json`) limits:** `script-src 'self' https://cdn.jsdelivr.net` — **no inline scripts**; any new JS dependency must be an ESM URL on `cdn.jsdelivr.net`. `connect-src 'self' https://*.supabase.co` — browser code may only reach Supabase, so the judge must run on the server (`api/`) to touch Piston.
- **Paths from `dashboard/*.html` to API:** `../api/<fn>`. Signals: `pages/admin.js`, `pages/login.js` use `fetch('../api/...')`.
- **XSS:** always `escapeHtml()` dynamic strings; untrusted URLs go through `safeUrl()`.
- **New DB feature = new `db/<name>.sql`** with `IF NOT EXISTS`-safe statements + RLS policies, matching `cp_problems.sql` / `workshops.sql` style. Re-run is safe.
- **Design constraints:** exactly 5 palette colors, hard shadows, no flashing/blinking/glitch, respect `prefers-reduced-motion`. See `DESIGN.md`.

---

## 5. Competitive Programming judge (cheat sheet)

- The admin CP form includes **Allow multiple submissions**. It defaults to disabled; when enabled, failed attempts can be retried, while a submission that is already being judged or has been accepted remains protected.
- Apply `db/cp_multiple_submissions.sql` after `db/cp_problems.sql`. Its RPCs create attempts under a database lock and finalize verdicts plus the unique `challenge_awards` row in one transaction, so repeated/concurrent accepted requests cannot award points twice.

- Admin sets time limit (100–1000 ms) and memory limit (1–10 MB), allowed languages, and uploads a **single Codeforces-style test archive** `{ "input": "...", "expected": "..." }` — the input text starts with `t` (number of sub-tests) followed by all `t` data sets, and `expected` is the concatenated output. The browser gzips it and POSTs it to `api/cpTestUpload.js`, which re-verifies the admin session server-side and writes it with the service-role key (bypassing `storage.objects` RLS) to the **private** `cp-tests` bucket at `<challenge_id>/tests.json.gz`; the `cp_problems` row is then written (only visible when the challenge's category slug is `competitive-programming`).
- `api/cpSubmit.js`: auth via Bearer token → reads config + gunzips tests with the service-role key → runs the user's code **once** on Piston with the whole input as stdin → compares the full stdout vs the full expected output in one C++ comparator pass → persists verdict into `cp_submission_details` (AC/WA/TLE/RE/CE) and mirrors AC → `submissions.status='APPROVED'` (roadmap gating counts APPROVED).
- Submission page shows the CP file-attach block only when `cp_problems` has a row for the challenge; otherwise the repo-URL form appears.
- ALL verdicts are written server-side only; `submissions.submission_url` is now nullable (CP rows have none).