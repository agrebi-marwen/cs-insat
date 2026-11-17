# THE TIME PORTAL — deployable_platform

A gamified monthly coding-challenge platform built and maintained by the **IEEE CS INSAT Student Branch Chapter**.
Users solve monthly coding challenges (submit GitHub/GitLab repos or attach a source file for Competitive Programming challenges), earn Energy Points (EP), climb a 7-tier rank ladder, follow learning roadmaps, and watch workshop videos — all inside a 16-bit / 8-bit "temporal" design system (see `DESIGN.md`).

---

## 1. Stack

| Layer | Technology |
| :--- | :--- |
| Framework | Next.js 16 (App Router) + React 19, TypeScript (strict) |
| Data fetching | TanStack Query in the browser (shared cache, retries, optimistic updates) |
| Backend / Database | Supabase (PostgreSQL + Auth + Row Level Security) via `@supabase/ssr` (cookie sessions) |
| API | Next.js route handlers in `src/app/api/`, request bodies validated with zod |
| Judge | Piston API (`PISTON_BASE_URL`, optional `PISTON_API_KEY`) |
| Styling | The original design-system CSS, unchanged, in `public/assets/css/` |
| Tests | Vitest (`src/lib/__tests__/`) |

---

## 2. Repository Layout

```
/
├── src/
│   ├── proxy.ts              per-request CSP nonce + Supabase session refresh
│   ├── app/
│   │   ├── page.tsx          public landing page
│   │   ├── account/          login, signup
│   │   ├── dashboard/        layout (auth guard + shell) and one folder per page
│   │   ├── admin/admin/      admin panel (role guard + password gate)
│   │   └── api/              authLogin, authSignup, adminCheck, rateLimit,
│   │                         cpSubmit (judge), cpTestUpload
│   ├── components/           Providers, Effects, dashboard shell, modals
│   ├── lib/                  judge.ts, utils.ts, queries.ts, supabase/, server/
│   ├── legacy/               JS carried over as modules: admin-panel.js, galaxy-bg.js
│   └── types/db.ts           row types
├── public/assets/            css/ (design system) and images/
├── db/                       *.sql schema + RLS, run in Supabase SQL Editor
├── next.config.ts            security headers + redirects from the old .html URLs
├── DESIGN.md                 design system spec
├── PROJECT_RESUME.md         feature-by-feature documentation
└── SECURITY_AUDIT.md / RLS.md
```

---

## 3. How to Run

```bash
npm install
```

```bash
npm run dev
```

Other scripts: `npm run build`, `npm run typecheck`, `npm test`.

Copy `.env.example` to `.env.local` and fill it in (or `vercel env pull`).

### Deploy

Push to the Vercel project; `vercel.json` pins the framework to Next.js.

### Environment variables

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server only; used by the judge and the test-file upload
- `ADMIN_PASSWORD` — second factor for the admin panel (`/api/adminCheck`)
- `PISTON_BASE_URL` — required for the judge, e.g. `http://localhost:2000/api/v2`
- `PISTON_API_KEY` — optional `Authorization` header for Piston
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — optional, persistent auth rate limiting

Database schema lives in `db/*.sql`; apply new migrations in the Supabase SQL Editor.

---

## 4. Conventions & gotchas (read before editing)

- **Routes keep the old URLs** (`/dashboard/dashboard`, `/dashboard/submit?id=…`, `/admin/admin`); the old `.html` URLs redirect.
- **Auth:** the session lives in cookies. `src/app/dashboard/layout.tsx` and `src/app/admin/admin/page.tsx` guard on the server; API routes authenticate with `authenticate()` from `src/lib/server/auth.ts`. Data access still relies on Supabase RLS.
- **CSS is linked, not bundled.** `<Styles sheets={[…]}/>` links the section sheets and then `global.css`, preserving the original cascade order. Each section (landing, account, dashboard, admin) has section-wide rules, so links *between* sections are plain `<a>` (full load); use `next/link` only inside the dashboard.
- **Content Security Policy** is built per request in `src/proxy.ts` (script nonce, `connect-src` limited to this origin and the Supabase project). Browser code cannot reach Piston; the judge runs in `/api/cpSubmit`.
- **Judge logic is pure and tested** (`src/lib/judge.ts`). Change it together with `src/lib/__tests__/judge.test.ts`.
- **`src/legacy/admin-panel.js`** is the previous admin script wrapped as a module (plain JS, DOM-driven). New admin work should move sections into typed React components.
- **New DB feature = new `db/<name>.sql`** with `IF NOT EXISTS`-safe statements + RLS policies. Re-run is safe.
- **Design constraints:** exactly 5 palette colors, hard shadows, no flashing/blinking/glitch, respect `prefers-reduced-motion`. See `DESIGN.md`.

---

## 5. Competitive Programming judge (cheat sheet)

- The admin CP form includes **Allow multiple submissions**. It defaults to disabled; when enabled, failed attempts can be retried, while a submission that is already being judged or has been accepted remains protected.
- Apply `db/cp_multiple_submissions.sql` after `db/cp_problems.sql`. Its RPCs create attempts under a database lock and finalize verdicts plus the unique `challenge_awards` row in one transaction, so repeated/concurrent accepted requests cannot award points twice.

- Admin sets time limit (100–1000 ms) and memory limit (1–10 MB), allowed languages, and uploads a **single Codeforces-style test archive** `{ "input": "...", "expected": "..." }` — the input text starts with `t` (number of sub-tests) followed by all `t` data sets, and `expected` is the concatenated output. The browser gzips it and POSTs it to `api/cpTestUpload.js`, which re-verifies the admin session server-side and writes it with the service-role key (bypassing `storage.objects` RLS) to the **private** `cp-tests` bucket at `<challenge_id>/tests.json.gz`; the `cp_problems` row is then written (only visible when the challenge's category slug is `competitive-programming`).
- `api/cpSubmit.js`: auth via Bearer token → reads config + gunzips tests with the service-role key → runs the user's code **once** on Piston with the whole input as stdin → compares the full stdout vs the full expected output in one C++ comparator pass → persists verdict into `cp_submission_details` (AC/WA/TLE/RE/CE) and mirrors AC → `submissions.status='APPROVED'` (roadmap gating counts APPROVED).
- Submission page shows the CP file-attach block only when `cp_problems` has a row for the challenge; otherwise the repo-URL form appears.
- ALL verdicts are written server-side only; `submissions.submission_url` is now nullable (CP rows have none).