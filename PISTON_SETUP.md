# Piston judge — first-time setup on a new PC

This guide turns a Windows PC into a judge machine for The Time Portal: it runs
[Piston](https://github.com/engineer-man/piston) (the engine that compiles and
runs submissions) in Docker, with the fixes and limits the platform needs.

All commands are for **cmd** (Command Prompt). Run them one at a time.

**Time needed:** about 30–45 minutes (mostly downloads).

---

## Part 1 — Install Docker (once per PC)

1. **Check virtualization.** Task Manager → Performance → CPU → *Virtualization: Enabled*.
   If it says *Disabled*, enable **VT-x / AMD-V** in the BIOS first.

2. **Install WSL 2.** Open cmd **as Administrator**, run this, then **restart the PC**:
   ```
   wsl --install
   ```

3. **Install Docker Desktop** from https://www.docker.com/products/docker-desktop
   (Windows, AMD64). Keep **"Use WSL 2 instead of Hyper-V"** checked. Restart if asked.

4. **Open Docker Desktop** and wait until it shows **Engine running**. Then, in a normal cmd:
   ```
   docker version
   ```
   You must see both a **Client** and a **Server** section.

> Docker Desktop must be running whenever this PC is used as a judge.

---

## Part 2 — Install and fix Piston

### Step 1 — Start Piston
```
docker run -d --name piston --restart unless-stopped -p 2000:2000 --privileged -v piston-packages:/piston/packages ghcr.io/engineer-man/piston
```

### Step 2 — Install the languages
Run them **one at a time**. Each takes a few minutes and shows nothing until it is
done; it finishes by printing something like `{"language":"gcc","version":"10.2.0"}`.
```
curl -X POST http://localhost:2000/api/v2/packages -H "Content-Type: application/json" -d "{\"language\":\"gcc\",\"version\":\"10.2.0\"}"
```
```
curl -X POST http://localhost:2000/api/v2/packages -H "Content-Type: application/json" -d "{\"language\":\"java\",\"version\":\"15.0.2\"}"
```
```
curl -X POST http://localhost:2000/api/v2/packages -H "Content-Type: application/json" -d "{\"language\":\"python\",\"version\":\"3.12.0\"}"
```
`gcc` provides both C and C++. These are the newest versions Piston offers.

### Step 3 — Allow large requests
Piston rejects requests over 100 KB by default, which breaks big test files.
```
docker exec piston sed -i "s/body_parser.json()/body_parser.json({ limit: '50mb' })/" /piston_api/src/index.js
```

### Step 4 — Fix the input (stdin) bug
Without this, programs receive only the first ~214 KB of their input, and
C / C++ / Java hang on large inputs. Run the three commands **in this order**:
```
docker exec piston sed -i "/proc.stdin.destroy();/d" /piston_api/src/job.js
```
```
docker exec piston sed -i "s/proc.stdin.write(this.stdin);/proc.stdin.on('error', () => {}); if (file === 'run') proc.stdin.write(this.stdin);/" /piston_api/src/job.js
```
```
docker exec piston sed -i "s/proc.stdin.end();/proc.stdin.end(); proc.on('exit', () => proc.stdin.destroy());/" /piston_api/src/job.js
```

### Step 5 — Check both fixes
```
docker exec piston grep -n "body_parser.json" /piston_api/src/index.js
```
➜ must show `body_parser.json({ limit: '50mb' })`
```
docker exec piston grep -n "proc.stdin" /piston_api/src/job.js
```
➜ must show `if (file === 'run') proc.stdin.write(this.stdin);` and `proc.on('exit', () => proc.stdin.destroy());`

### Step 6 — Save the fixed container as an image
```
docker commit piston piston-judge
```

### Step 7 — Recreate it with the platform's limits
The languages are kept: they live in the `piston-packages` volume.
```
docker rm -f piston
```
```
docker run -d --name piston --restart unless-stopped -p 2000:2000 --privileged -e PISTON_COMPILE_TIMEOUT=30000 -e PISTON_COMPILE_CPU_TIME=30000 -e PISTON_RUN_TIMEOUT=50000 -e PISTON_RUN_CPU_TIME=50000 -e PISTON_OUTPUT_MAX_SIZE=10485760 -v piston-packages:/piston/packages piston-judge
```

| Setting | Value | Why |
|---|---|---|
| `PISTON_COMPILE_TIMEOUT` / `_CPU_TIME` | 30 s | `#include <bits/stdc++.h>` can take > 10 s to compile |
| `PISTON_RUN_TIMEOUT` / `_CPU_TIME` | 50 s | time for **all tests** of a submission (the judge uses up to 45 s) |
| `PISTON_OUTPUT_MAX_SIZE` | 10 MB | default is 1 KB, which cuts most outputs |

> These values must match the website's judge code (`api/_lib/piston.js` and
> `api/_lib/judge.js`). If you change one, change the other.

### Step 8 — Check that everything works
```
curl http://localhost:2000/api/v2/runtimes
```
➜ must list **c, c++, d, fortran, java, python**.

If the list is empty (`[]`), **do not reinstall anything** — see *Troubleshooting*.

---

## Part 3 — Connect the PC to the website

### For local testing (`vercel dev` on this same PC)
In `cs-insat\.env`, set the following, then restart `vercel dev`:
```
PISTON_BASE_URL="http://localhost:2000/api/v2"
```

### For the live website (Vercel)
Vercel cannot reach `localhost`, so the PC needs a tunnel.

1. Install the tunnel tool (once), then **close and reopen cmd**:
   ```
   winget install Microsoft.devtunnel
   ```
2. Log in and create a **named, permanent** tunnel (once per PC):
   ```
   devtunnel user login
   ```
   ```
   devtunnel create piston -a
   ```
   ```
   devtunnel port create piston -p 2000
   ```
3. Start it — **keep this window open** while judging:
   ```
   devtunnel host piston
   ```
   It shows a link like `https://xxxxx-2000.euw.devtunnels.ms`.
4. In Vercel → Project → Settings → Environment Variables (Production), set
   `PISTON_BASE_URL` to that link **plus `/api/v2`**:
   ```
   https://xxxxx-2000.euw.devtunnels.ms/api/v2
   ```
   then **redeploy** (environment variables only apply to new deployments).

Because the tunnel is named, the link stays the same after a restart — just run
`devtunnel host piston` again.

> ⚠️ The link must end with **`/api/v2`**, otherwise every submission fails with
> `Piston execute failed (404)`.

---

## Shortcut — copy a ready PC instead of installing

If another judge PC is already fully set up, you can skip **Part 2, steps 1–7**
(no downloads from GitHub needed).

**On the ready PC** (cmd, in a folder with a few GB free):
```
docker save -o piston-judge.tar piston-judge
```
```
docker run --rm -v piston-packages:/data -v "%cd%":/backup alpine tar czf /backup/piston-packages.tgz -C /data .
```
Copy `piston-judge.tar` and `piston-packages.tgz` to the new PC (USB stick, shared drive).

**On the new PC** (after Part 1), open cmd **in the folder with the two files**:
```
docker load -i piston-judge.tar
```
```
docker run --rm -v piston-packages:/data -v "%cd%":/backup alpine tar xzf /backup/piston-packages.tgz -C /data
```
```
docker run -d --name piston --restart unless-stopped -p 2000:2000 --privileged -e PISTON_COMPILE_TIMEOUT=30000 -e PISTON_COMPILE_CPU_TIME=30000 -e PISTON_RUN_TIMEOUT=50000 -e PISTON_RUN_CPU_TIME=50000 -e PISTON_OUTPUT_MAX_SIZE=10485760 -v piston-packages:/piston/packages piston-judge
```
Then do **Step 8** and **Part 3**.

---

## Daily use

- Start **Docker Desktop** — Piston starts automatically with it.
- For the live website, run `devtunnel host piston` and keep the window open.
- Quick health check: `curl http://localhost:2000/api/v2/runtimes`

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Language install fails with `connect ECONNREFUSED 185.199.x.x:443` | GitHub downloads blocked or a temporary GitHub hiccup | Retry 2–3 times; turn off VPN / antivirus web protection; use a phone hotspot for the download; or use the **Shortcut** above |
| `curl: executable file not found` inside the container | The Piston image has no curl | Run curl on the PC itself, not with `docker exec` |
| `runtimes` is `[]` after recreating the container | The container was created without `-v piston-packages:/piston/packages` | Recreate it with exactly the Step 7 command; check with `docker inspect piston --format "{{json .Mounts}}"` |
| `PayloadTooLargeError: request entity too large` | Step 3 not applied (or the image was rebuilt from the original) | Redo Step 3, then Step 6 |
| Large tests fail / C++ hangs (`504`) on big inputs | Step 4 not applied | Redo Step 4, then Step 6 |
| Output cut off / status `OL` | Output limit is still 1 KB | Recreate with `PISTON_OUTPUT_MAX_SIZE` (Step 7) |
| `run_timeout cannot exceed the configured limit` | The container still has the old 10 s cap | Recreate with Step 7 (50000) |
| Every submission: `Piston execute failed (404)` | `PISTON_BASE_URL` does not end with `/api/v2`, or the tunnel is down | Fix the variable, redeploy, check `devtunnel host piston` is running |
| Submissions say "contact the hosts" | The judge PC is off, asleep, or the tunnel stopped | Wake the PC, start Docker Desktop and the tunnel |

### Never lose the installed languages
- Always keep `-v piston-packages:/piston/packages` in every `docker run`.
- Before removing a container, you can check the languages are in the volume:
  ```
  docker exec piston ls /piston/packages
  ```
  ➜ should show `gcc`, `java`, `python`.
