# PROJECT RESUME — The Time Portal

A gamified monthly coding-challenge platform built and maintained by the **IEEE CS INSAT Student Branch Chapter**. Users solve monthly coding challenges — submitting GitHub/GitLab repository links, or attaching a source file for auto-graded Competitive Programming challenges — earn Energy Points (EP), and climb a 7-tier rank ladder — all inside a cohesive 16-bit / 8-bit "temporal" design system.

---

## 1. Tech Stack

| Layer | Technology |
| :--- | :--- |
| Frontend | Vanilla HTML5, CSS3, JavaScript (no framework) |
| CP Submission | Attach a source file (`.c`, `.cpp`, `.cc`, `.cxx`, `.py`, `.java`); language auto-detected from the extension, sent to the judge |
| Backend / Database | Supabase (PostgreSQL + Auth + Row Level Security) |
| CP Judge | Piston API (configurable; local Docker Piston or an authorized hosted instance) with a C++ output comparator running on Piston itself |
| Serverless Functions | Vercel (Node.js ESM) — `api/config`, `api/rateLimit`, `api/authLogin`, `api/authSignup`, `api/adminCheck`, `api/cpSubmit` |
| Runtime Dependencies | Supabase JS SDK (`supabase-js`), Google Fonts (Press Start 2P, VT323, Space Grotesk) |
| Deployment | Vercel (`vercel.json`), or local via `python -m http.server` |

---

## 2. Core Functionalities

### 2.1 Public Landing Page (`index.html`)
- Hero section with "Enter Time Rift" CTA and tagline.
- Team showcase of the IEEE CS INSAT officers (photo, role, LinkedIn/email links).
- **Public leaderboard**: top 3 travelers by EP (no login required).
- **Latest anomalies**: last 3 active challenges pulled live from the database, each with epoch label, title, description snippet, and EP reward, linking straight to the challenge archive.
- **Dynamic auth navbar**: swaps the "Sign Up" button for the logged-in username + EP + logout button when a session exists.

### 2.2 Authentication (`account/`)
- **Signup** (`signup.html`): username / email / password with
  - Password-strength validation (min 8 chars, uppercase, lowercase, digit),
  - Confirm-password matching,
  - Duplicate-username and duplicate-email checks,
  - Rate limiting via serverless endpoint.
- **Login** (`login.html`): email + password with rate limiting, session persistence, auto token refresh, and automatic redirect if already logged in.

### 2.3 User Dashboard (`dashboard/dashboard.html`)
- **HUD stats**: Temporal Rank (7-tier ladder: Novice Traveler → Chronos Engineer → Temporal Artisan → Paradox Hunter → Timeline Guardian → Epoch Master → Grand Time Lord), Energy Points, and Anomalies Solved (count of APPROVED submissions).
- **Segmented rank progress bar** with "EP to next rank" indicator.
- **Mission Progress**: active challenges with the user's latest submission status (Approved / Rejected / Pending Review / Not Started).
- **Per-Epoch Stats**: approved/total patches per deployment month, rendered as segmented pixel bars.
- **Leaderboard modal**: paginated rankings (50 per page) with "Load More Travelers".
- **Settings modal**: update public username and password (Supabase auth update).
- **Auto-provisioning**: creates a default profile row if the user has none.
- **Stealth admin gateway**: hidden Shift+click sequence on the rank stat decodes (base64) and redirects to the admin panel.

### 2.4 Challenge Archive (`dashboard/challenges.html`)
- All challenges ever deployed, **grouped by month/year epoch**, newest first.
- Active challenges are clickable (→ submit page); archived ones are visually marked.
- Supports a `?target=<challenge-id>` deep link from the homepage, with smooth scroll + highlight.

### 2.5 Submission Flow (`dashboard/submit.html`)
- Displays full challenge details (title, month epoch, EP reward, instructions) tinted with the epoch color.
- **Repo submission (default)**: accepts a GitHub or GitLab repository URL, validated by regex on both client (HTML pattern) and JS; inserts a submission with `status = PENDING`.
- **Competitive Programming mode**: when the challenge's category slug is `competitive-programming`, the repo form is replaced with a **file-attach** area (with a language selector auto-populated from the admin's allowed-languages list and pre-filled from the file extension), a limits bar (time + memory), and a **Run & Submit** button. The attached source file is read client-side and POSTed to `../api/cpSubmit`; verdict (AC/WA/TLE/RE/CE) is shown inline as a banner with a particle burst on AC.
- Success feedback with an animated particle burst.

### 2.6 Submissions Log (`dashboard/submissions.html`)
- Table of the user's submission history: timestamp, challenge title (joined from `challenges`), **Details** column (repo URL for regular challenges; language badge + verdict badge for CP challenges), and status badge.

### 2.7 Admin Panel (`admin/admin.html`)
- **Two-step authorization**: (1) Supabase database role check (`role = 'admin'`), (2) admin password loaded from the serverless config endpoint (kept secret from the client).
- **Deploy new challenge**: title, EP reward, instructions, active toggle — automatically tagged to the current month/year. Selecting a `Competitive Programming` category reveals an inline judge-config panel: time limit (100–1000 ms), memory limit (1–10 MB), allowed languages (C++/C/Python/Java checkboxes), and a **single Codeforces-style test file** `{ "input": "...", "expected": "..." }` (input starts with `t`, the number of sub-tests; gzipped client-side into the private `cp-tests` storage bucket).
- **Review pending submissions**: approve or reject, with animated card removal and live refresh; pending CP submissions now show language + verdict alongside the approve/reject buttons.
- **Roadmap operations**: deploy/edit/delete learning paths (title, slug, description, difficulty) and manage their steps (add, edit, delete, reorder via up/down, resources as `Title | URL` lines).

### 2.8 Learn — Roadmaps (`dashboard/learn.html`, `dashboard/roadmap.html`)
- **Path index**: all deployed learning paths as cards with difficulty tag, description, step count, and a segmented per-user progress bar.
- **Path detail**: ordered step list with descriptions and curated resource links; each step is a pixel checkbox.
- **Per-account progress**: step completion stored in `roadmap_progress` (scoped to `auth.uid()`), updated live when toggling a step.
- **Schema** (`db/roadmaps.sql`): `roadmaps`, `roadmap_steps` (ordered, `resources` jsonb), and `roadmap_progress` tables with RLS — run in the Supabase SQL Editor (includes seed data for Competitive Programming, AI/ML, Data Science, Cybersecurity).

### 2.9 Workshops — Video Archive (`dashboard/workshops.html`)
- **Login-gated archive**: recorded workshop videos organized by admin-defined categories, with filter pills (All + each category).
- **Category theming**: each category gets its own epoch hue (`--epoch-hue` from its slug), applied to badges, borders, and hover accents.
- **Player modal**: clicking a workshop card opens a responsive 16:9 modal with Google Drive's built-in player (the stored Drive share link is normalized to `https://drive.google.com/file/d/<ID>/preview` on the client).
- **Admin management** (`admin/admin.html`): deploy/edit/delete workshops (title, category, Drive link, duration, description, published date) and manage categories (auto-slugged, edit/delete).
- **Schema** (`db/workshops.sql`): `workshop_categories` (slug unique) and `workshops` (category FK → CASCADE) with RLS — reads for `authenticated`, writes restricted to admins (`profiles.role = 'admin'`).

### 2.10 Competitive Programming Judge (`api/cpSubmit.js`)
- **Config**: per-challenge row in `cp_problems` (time limit, memory limit, allowed languages, gzipped test file path in `cp-tests` bucket). Created inline by the admin when the challenge category is `competitive-programming`.
- **Judge flow** (`api/cpSubmit.js`): authenticates the caller → loads config + gunzips tests server-side (via the private `SUPABASE_SERVICE_ROLE_KEY`) → **runs the user's code once** on Piston against the whole Codeforces-style input (which starts with `t` = number of sub-tests) → compares the full stdout against the full expected output in a single C++ comparator pass → persists verdict (`cp_submission_details.verdict`: AC/WA/TLE/RE/CE) and mirrors AC to `submissions.status = 'APPROVED'` (existing roadmap gating counts APPROVED submissions). One submission = one Piston execute call = one comparator run.
- **Comparator** (`api/_lib/piston.js`): length-prefixed stdin of `(actual, expected)` byte pairs; normalizes trailing whitespace per line, drops trailing blank lines; returns `AC\n` or `WA\n<index>`.
- **Schema** (`db/cp_problems.sql`): `cp_problems` (one per challenge, unique FK), `cp_submission_details` (one per submission, unique FK, code + verdict + time/memory stats + per-test jsonb), private `cp-tests` storage bucket (admin-only insert/update/delete), `submissions.submission_url` made nullable.

---

## 3. Security Measures

- **XSS protection**: all dynamic strings escaped via `escapeHtml()` before interpolation; untrusted URLs whitelisted through `safeUrl()` (only `http(s)://`).
- **DevTools tampering resistance**: blocks right-click, F12, Ctrl+Shift+I/J, Ctrl+U; periodic `debugger` statement pauses execution while DevTools is open.
- **Serverless config endpoint** (`api/config`): serves Supabase credentials and admin password from environment variables — never exposed in client source; adds CORS allowlist, `X-Content-Type-Options`, `X-Frame-Options`, HSTS, CSP, and 1-hour caching.
- **Rate limiting** (`api/rateLimit`): 5 auth attempts per 15 minutes per IP+email hash (SHA-256), returns HTTP 429 with retry-after.
- **Auth hardening**: password-strength policy, session persistence, route guards (pages redirect unauthenticated users to login).
- **CP judge (server-side only)**: test files live in a private Supabase Storage bucket (`cp-tests`) readable only with `SUPABASE_SERVICE_ROLE_KEY`; the `api/cpSubmit.js` endpoint reads tests and writes results server-side — no hidden tests or API keys ever reach the browser. `cp_problems` rows are readable by `authenticated` users (to show the editor), but storage objects are not.
- **Piston API key**: `PISTON_API_KEY` is sent as the `Authorization` header when set. The emkc.org public endpoint is whitelist-only as of February 15, 2026; local development uses Docker Piston through `PISTON_BASE_URL`.

---

## 4. Architecture & Performance

- **Centralized config loading** (`assets/js/config.js`): fetches credentials from the Vercel serverless function with environment auto-detection (localhost vs. production) and a `waitForConfig()` promise.
- **Client-side API cache** (`assets/js/api-cache.js`): TTL-based (5 min) request deduplication for Supabase queries to reduce redundant network calls.
- **DOM batching**: challenge/leaderboard lists built with `DocumentFragment` for a single reflow.
- **Pagination**: leaderboard limited to 50 rows per fetch with incremental "load more".
- **Clean deployment** via `vercel.json` (`cleanUrls`, no trailing slashes).

---

## 5. Frontend Experience & Effects

- **WebGL galaxy starfield** (`assets/js/galaxy-bg.js`): layered drifting stars with mouse parallax — transparent, DPR-aware, disabled on mobile/touch, and static under `prefers-reduced-motion`.
- **Cursor spotlight & dynamic lighting** (`assets/js/cursor-lighting.js`): spotlight overlay, smooth-follow cursor ring, and per-card mouse tracking for hover lighting.
- **Dark / light theme** (`assets/js/theme.js`): persisted toggle, applied before first paint.
- **Epoch theming** (`assets/js/creative.js`): deterministic per-month hue derived from the 5-color palette (`epochHue`), success particle bursts.
- **Design system** (`DESIGN.md`): near-black starfield base, 5-color palette, chunky hard shadows, 8-bit bevel framing, segmented HUD bars, pixel/mono/body type hierarchy, and a strict no-flashing motion policy.

---

## 6. Key Files

| Path | Purpose |
| :--- | :--- |
| `index.html` / `assets/js/pages/index.js` | Public landing page logic |
| `account/login.html` / `assets/js/pages/login.js` | Login page |
| `account/signup.html` / `assets/js/pages/signup.js` | Signup page |
| `dashboard/dashboard.html` / `assets/js/pages/dashboard.js` | Main user dashboard |
| `dashboard/challenges.html` / `assets/js/pages/challenges.js` | Challenge archive |
| `dashboard/submit.html` / `assets/js/pages/submit.js` | Solution submission (repo URL or CP file attach) |
| `dashboard/submissions.html` / `assets/js/pages/submissions.js` | Submission history (verdicts for CP) |
| `admin/admin.html` / `assets/js/pages/admin.js` | Admin: deploy challenges + CP config + review subs + roadmap mgmt |
| `dashboard/learn.html` / `assets/js/pages/learn.js` | Learning path index with progress |
| `dashboard/roadmap.html` / `assets/js/pages/roadmap.js` | Path detail: steps, resources, per-account completion |
| `dashboard/workshops.html` / `assets/js/pages/workshops.js` | Workshop video archive with category filters + player modal |
| `db/cp_problems.sql` | CP judge tables, `cp-tests` storage bucket, RLS policies |
| `db/roadmaps.sql` | Supabase schema + RLS + seed data for the Learn feature |
| `db/workshops.sql` | Supabase schema + RLS for the Workshops feature |
| `api/config.js` | Secure config serverless function |
| `api/authLogin.js` / `api/authSignup.js` | Server-side auth endpoints (rate-limited) |
| `api/adminCheck.js` | Admin role + password verification |
| `api/cpSubmit.js` | CP judge endpoint (Piston + comparator, maxDuration 60 s) |
| `api/_lib/piston.js` | Piston client, language config, C++ comparator constant |
| `api/rateLimit.js` | Auth rate-limiting serverless function |
| `assets/js/` | Shared helpers: config, common, security, cache, theme, galaxy, lighting, creative |
| `assets/css/` | `global.css` + per-context stylesheets including `dashboard.css` (CP file-attach/verdict CSS) |
| `DESIGN.md` | Design system specification |
| `PROJECT_RESUME.md` | This file |
