# THE TIME PORTAL

A gamified monthly coding-challenge platform built and maintained by the **IEEE CS INSAT Student Branch Chapter**.

Users solve monthly challenges (by submitting a GitHub/GitLab repo, or a source file for Competitive Programming challenges), earn Energy Points (EP), climb a 7-tier rank ladder, follow learning roadmaps and watch workshop videos, all inside a 16-bit / 8-bit "temporal" design system (see [DESIGN.md](DESIGN.md)).

---

## Run it locally (step by step)

These are the exact steps used to get the project running on Windows. You need access to the `cs-insat` Vercel project (team **BG1BZ**).

### 1. Install the Vercel CLI and log in

```bash
npm i -g vercel
```
```bash
vercel login
```

### 2. Clone the repo and go into it

```bash
git clone https://github.com/agrebi-marwen/cs-insat.git
```
```bash
cd cs-insat
```

Run every following command **from inside this folder** (the one containing `api/`, `vercel.json`, `index.html`).

### 3. Link the folder to the Vercel project

```bash
vercel link --project cs-insat
```

Choose the **BG1BZ** team when asked.

### 4. Pull the environment variables into `.env`

All variables are set for **Production** only, so pull that environment, and pull into **`.env`** (not `.env.local`):

```bash
vercel env pull .env --environment=production
```

Check that `.env` now contains real values for `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD` and `PISTON_BASE_URL`.

> **Why `.env`?** For this project (static pages + functions, no framework) `vercel dev` only reads `.env`. With the variables only in `.env.local`, `SUPABASE_URL` is empty and login fails with `Failed to parse URL from /auth/v1/token...`.

> **Why `--environment=production`?** A plain `vercel env pull` downloads the *Development* variables, and there are none, so you'd only get `VERCEL_OIDC_TOKEN`.

> **Heads-up:** this is the real production database and service-role key. What you do locally changes real data. `.env` and `.env.local` are in `.gitignore`; never commit them.

### 5. Check `PISTON_BASE_URL`

The judge runs code on Piston (exposed through a dev tunnel on port 2000). The URL **must end with `/api/v2`**:

```env
PISTON_BASE_URL="https://<your-tunnel-host>/api/v2"
```

Without `/api/v2`, CP submissions fail with `Piston execute failed (404): Not Found`. You can test the URL in a browser: `https://<your-tunnel-host>/api/v2/runtimes` should return a JSON list of languages.

### 6. Start the dev server

```bash
vercel dev
```

Stop any other `vercel dev` that is already running first, otherwise you may end up on an old server with old variables.

### 7. Open the site

Go to **http://localhost:3000/account/login**, hard-refresh with **Ctrl+Shift+R**, and log in.

If you pull the variables again later, restart `vercel dev` afterwards.
---

## Troubleshooting

| Error | Cause / fix |
| :--- | :--- |
| `Failed to parse URL from /auth/v1/token...` | `SUPABASE_URL` is empty at runtime. Variables are in `.env.local` instead of `.env`, or the pull grabbed the wrong environment (use `--environment=production`). Restart `vercel dev`. |
| `Error: authentication service unavailable.` | The page couldn't reach `/api/authLogin`. Make sure you opened the site through `vercel dev` (not a static server) and hard-refresh. |
| `Piston execute failed (404): Not Found` | `PISTON_BASE_URL` is missing the `/api/v2` suffix. |
| `PISTON_BASE_URL is not set` | Add it. The app refuses to fall back to the public Piston API. |
| Port 3000 busy / login hits an old server | Another `vercel dev` is still running. Stop it, or use `vercel dev --listen 3001`. |

---

## Repository layout

```
/
├── index.html               public landing page
├── account/                 login, signup
├── dashboard/               dashboard, challenges, submit, submissions, roadmaps, learn, workshops
├── admin/                   admin console
├── api/                     Vercel serverless functions (ESM)
│   ├── _lib/                shared helpers (not routes): supabase, http, rateLimit, piston
│   ├── config.js            serves Supabase URL + anon key to the browser
│   ├── authLogin.js / authSignup.js / rateLimit.js
│   ├── adminCheck.js        admin role + password check
│   ├── cpTestUpload.js      admin uploads CP test archives
│   └── cpSubmit.js          the CP judge (maxDuration 60s)
├── assets/js/               shared scripts; assets/js/pages/ has one file per page
├── assets/css/
├── db/                      SQL schema + RLS policies
├── supabase/migrations/     Supabase CLI migrations
├── vercel.json              security headers / CSP + function settings
├── DESIGN.md                design system
├── PROJECT_RESUME.md        feature documentation
└── SECURITY_AUDIT.md / RLS.md
```

---

## Conventions (read before editing)

- **No build step.** Pages load `theme.js`, then `config.js` → `common.js` → shared scripts → `pages/<page>.js` (all `defer`). Page scripts start with `initApp(initPageFn)`, and protected pages call `requireSession()`.
- **API functions are ESM** (`import` / `export default`). Files in `api/_lib/` are never deployed as routes.
- **CSP (`vercel.json`):** no inline scripts; external JS only from `cdn.jsdelivr.net`; the browser may only connect to itself and `*.supabase.co`, so anything touching Piston must run in `api/`.
- **API paths** from pages are relative: `fetch('../api/<fn>')`.
- **XSS:** pass dynamic strings through `escapeHtml()` and untrusted URLs through `safeUrl()`.
- **New DB feature** = new `db/<name>.sql` with re-runnable (`IF NOT EXISTS`) statements and RLS policies.
- **Design:** exactly 5 palette colors, hard shadows, no flashing/glitch effects, respect `prefers-reduced-motion`. See `DESIGN.md`.

---

## Competitive Programming judge

- Admins set the time limit (100–1000 ms), memory limit (1–10 MB) and allowed languages, and upload one Codeforces-style test archive `{ "input": "...", "expected": "..." }`. The browser gzips it and `api/cpTestUpload.js` stores it in the private `cp-tests` bucket at `<challenge_id>/tests.json.gz`.
- `api/cpSubmit.js` authenticates the user, loads the tests with the service-role key, runs the code **once** on Piston with the whole input as stdin, compares stdout with a C++ comparator, and saves the verdict (AC/WA/TLE/RE/CE) to `cp_submission_details`. AC also marks the submission `APPROVED`.
- **Allow multiple submissions** (admin option, off by default) lets users retry failed attempts. The RPCs in `cp_multiple_submissions.sql` lock and finalize atomically, so points can't be awarded twice.
- All verdicts are written server-side only.
