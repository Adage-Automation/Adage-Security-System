# Deployment

**Live as of 2026-09-11**, on the free-tier path described below:
- **Frontend**: Vercel (`frontend/vercel.json` proxies `/api/*` to the backend, and rewrites everything else to `index.html` for the SPA)
- **Backend**: Render, `https://adage-security-system.onrender.com`
- **Database + storage**: Supabase Postgres, `ap-south-1` (Mumbai) — see [decisions.md](./decisions.md#database-provider-supabase-mumbai)
- **Email**: Microsoft Graph API via Adage's own Microsoft 365 tenant

This document still describes the general target architecture and checklist below — read it as "what's actually running" plus "how to redeploy from scratch or add a second environment," not as a hypothetical plan. See [roadmap.md](./roadmap.md) for current feature status and `CHANGELOG.md` for the deploy history.

## Free-tier deployment path (2026)

A fully working, $0/month deployment is realistic for this app's scale (a few hundred employees, internal tool, modest traffic) — every layer already picked (Supabase, Microsoft Graph via Adage's existing 365 tenant) is free at this size, and the remaining two layers (frontend hosting, backend hosting) both have real free options. This is internet-hosted, not a local/LAN server — once deployed, it's reachable from any location with internet access (any gate, any device), which is the whole point of a guard-facing PWA.

**Frontend (static PWA build)** — any of these host it for free, indefinitely, no time limit or spin-down (static files on a CDN, not a server that idles):
- **Cloudflare Pages** — unlimited bandwidth on the free plan, generally the most generous for a low-traffic internal tool.
- **Vercel** or **Netlify** — also genuinely free for a static/PWA build at this traffic level; either works equally well.

**Backend (NestJS API + Puppeteer)** — this is the layer that actually needs an always-running process, and free options differ a lot here. As of 2026:
- **Render's free tier is what's actually deployed** (see the "Live as of" note above). The web service spins down after 15 minutes of inactivity, with a 30–60 second cold start on the next request — a real problem for a guard tapping ENTRY/EXIT and expecting an instant response, mitigated (not eliminated) by the keep-alive setup described below rather than by moving off Render outright.
- **Railway** no longer has a real ongoing free tier — new accounts get a one-time $5 trial credit, then drop to $1/month of credit, which isn't enough for an always-on service with a database-adjacent workload.
- **Fly.io** removed its free allowance in 2024 — new accounts only get a short trial before requiring a card.
- **Oracle Cloud "Always Free"** is the strongest genuinely-free *always-on* option on paper: a real VM with no PaaS-style spin-down, currently 2 ARM (Ampere A1) OCPUs + 12 GB RAM (or split across VMs), 200 GB disk, 10 TB/month egress, or two small AMD micro VMs (1 GB RAM each) as a fallback if ARM capacity isn't available at signup in your region (a known, occasional Oracle sign-up friction point). Worth the caveat: Oracle explicitly reserves the right to reclaim an Always Free instance if its CPU/network/memory all stay under ~20% utilization for 7 straight days — a lightly-used internal tool like this one could plausibly trigger that, meaning even this "always-on" option would still need a periodic keep-alive ping to avoid reclamation, same as Render needs one to avoid sleeping. Not currently used; documented as the fallback if Render's cold-start becomes a real problem in practice.
- Whichever backend host is used, terminate TLS in front of it (Render does this automatically on its provided domain; Oracle would need a free Let's Encrypt cert via `certbot`, or Cloudflare's free plan in front of the VM).

**Database + object storage** — **Supabase free tier** (`ap-south-1`, Mumbai), live — 500 MB database, 1 GB file storage, both comfortably enough for this app's scale for a good while. One free-tier quirk to plan around: a free Supabase project auto-pauses after 7 days with no database request and needs a manual unpause from the dashboard — see "Keeping it alive" below for how this is currently handled.

**Email** — already free: Microsoft Graph API through Adage's own Microsoft 365 tenant, no separate email-vendor cost.

**Putting it together at $0/month** (as actually deployed): Vercel (frontend) + Render free tier (backend) + Supabase free tier (database + storage) + Microsoft Graph (email) + `GET /api/health` pinged regularly to keep both Render and Supabase from idling — see "Keeping it alive" below. The only recurring cost this doesn't cover is a custom domain name (a domain registrar isn't free anywhere) — Vercel and Render both work fine on their provider-issued subdomain if a custom domain isn't needed yet.

## Keeping it alive: Render sleep + Supabase auto-pause

Two separate free-tier idle behaviors, closed by the same mechanism:
- **Render** spins the backend down after 15 minutes with no incoming HTTP request (30–60s cold start on the next real request).
- **Supabase** auto-pauses a project after 7 days with no database activity (needs a manual unpause from the dashboard to recover — this is what happened 2026-09-21, surfacing as `MigrationsFailedToRun`/connection-pool-timeout errors in Supabase's own logs on resume; harmless, just a side effect of the cold resume).

`GET /api/health` (`backend/src/health/health.controller.ts`, public, does a real `SELECT 1`) exists specifically to be pinged regularly — one HTTP request to it satisfies both: it's an inbound request (keeps Render awake) that also touches the database (keeps Supabase from pausing).

**Pingers**:
1. `.github/workflows/keep-alive.yml` — a GitHub Actions schedule (`*/10 * * * *`) that curls `/api/health` (currently `--max-time 100`, bumped from 25 on 2026-09-22 after a real cold start measured at 33s). Free, but has two real limitations, not just one: GitHub auto-disables scheduled workflows after 60 days with zero commits/pushes to the repo, silently, with no alert — **and**, measured directly on 2026-09-22, GitHub's `schedule` trigger did not actually fire every 10 minutes as configured; observed runs were 2.5–5.5 hours apart. This alone is enough for the backend to fall asleep between pings, independent of the 60-day issue. See [decisions.md](./decisions.md#keep-alive-apihealth--a-scheduled-github-actions-ping).
2. **Recommended primary, not yet confirmed set up**: an external uptime monitor (e.g. [UptimeRobot](https://uptimerobot.com), free tier — 5-minute interval) pointed at the same `/api/health` URL. Real fixed-interval scheduling (not best-effort like GitHub Actions), no inactivity-based disabling, and it emails on real downtime too, so it doubles as basic monitoring. Given the finding above, this isn't just a redundant backup — it's the only mechanism actually capable of the 10-minute cadence this system needs.

If the app goes quiet for 60+ days and the GitHub Actions pinger silently stops, the external uptime monitor (if configured) keeps both services alive regardless — this is exactly why it's the recommended primary rather than relying on GitHub Actions alone.

## Target architecture (paid path, for later scale)

| Layer | Provider |
|---|---|
| Frontend (static PWA build) | Vercel, Netlify, or Cloudflare Pages |
| Backend (NestJS API) | Oracle Cloud (free, see above), Render, AWS, or Azure |
| Database | **Supabase Postgres, `ap-south-1` (Mumbai)** — see [decisions.md](./decisions.md#database-provider-supabase-mumbai) for why. Automated daily backups + PITR on paid tiers. |
| Object storage (emailed reports) | **Supabase Storage** (bundled with the same project, S3-compatible — reuses the `STORAGE_*` env vars) unless a separate AWS S3/Cloudflare R2 bucket is preferred |
| Domain | An Adage-controlled subdomain, e.g. `security.adage.com` (not hard-coded anywhere in the app — set via `FRONTEND_URL` / CORS config) |

### Setting up Supabase

1. Create a project at [supabase.com](https://supabase.com), region **Mumbai (ap-south-1)**.
2. **Database**: Project Settings → Database → Connection string (use the "Transaction" pooler string for the app; direct connection for migrations if needed) → set as `DATABASE_URL`.
3. **Storage**: Project Settings → Storage → S3 Connection — Supabase exposes an S3-compatible API. Create a bucket (e.g. `adage-security-reports`, kept private/non-public) and set:
   - `STORAGE_ENDPOINT` = the project's S3-compatible endpoint shown there
   - `STORAGE_REGION` = the project region
   - `STORAGE_BUCKET` = the bucket name
   - `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` = the generated S3 access keys
   No code changes are needed — `backend/src/reports/storage.service.ts` already speaks the S3 API generically.

## Environment variables to set in each environment

See `backend/.env.example` for the full list. At minimum, production needs its own: `DATABASE_URL`, `SESSION_SECRET` (long, random, unique — never reuse the dev value), `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/`MAIL_FROM_ADDRESS`/`SECURITY_EMAIL`, `STORAGE_*`, `FRONTEND_URL`, and `NODE_ENV=production` (this flips the session cookie to `secure`, which requires HTTPS).

## Pre-deployment checklist

- [ ] `DATABASE_URL` points at a production database, not the dev/seed database
- [ ] `SESSION_SECRET` is a fresh random value, not the `.env.example` placeholder
- [ ] Seed script has **not** been run against production (or if it was for initial admin setup, the seeded `ChangeMe123!` passwords have been rotated immediately)
- [ ] `NODE_ENV=production` is set so the session cookie is `secure`
- [ ] HTTPS is terminated in front of the backend (at the hosting provider or a reverse proxy) — the app assumes this and does not terminate TLS itself
- [ ] `FRONTEND_URL` (CORS) matches the actual deployed frontend origin
- [ ] Storage bucket exists, is **not** publicly readable, and its credentials are set
- [ ] Microsoft Graph email configuration uses the real Azure app credentials (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`), and `MAIL_FROM_ADDRESS` is the mailbox covered by the Exchange application access policy
- [ ] Database has automated backups configured at the provider level
- [ ] Backend server's OS timezone (`TZ`) is set to `Asia/Kolkata`, matching `APP_TIMEZONE`; this must be configured in the container/host runtime environment before the backend starts, not only in app code — see the timezone note in `docs/architecture.md`
- [ ] Puppeteer's Chromium is actually installed and reachable at runtime — **do not rely on `postinstall` alone.** On Render specifically (confirmed live, 2026-09-21): a cache-hit build (`npm install` reporting "up to date") skips re-running `postinstall` entirely, even if the script's contents changed, so Chrome silently never gets installed. Put `npx puppeteer browsers install chrome` directly in the platform's **Build Command** as its own step instead (see `docs/decisions.md`'s "Deploying to Render" entry for the exact command used), and set `PUPPETEER_CACHE_DIR` to a path that persists from build into the runtime container (Render: `/opt/render/project/.cache/puppeteer`). Verify by checking the build log for an actual Chrome download line, then testing "Email Details" for real in a staging deploy before going live.
- [ ] CI (`.github/workflows/ci.yml`) is green on the commit being deployed — it runs lint, backend/frontend tests, and the full build

## Build & run

This is an **npm workspaces** monorepo — there's one lockfile at the repo root (`backend/` and `frontend/` no longer have their own), so `npm ci` must run from the root, not from inside either subfolder.

```bash
# From the repo root — installs backend + frontend together, one lockfile
npm ci
npm run build               # builds backend/dist and frontend/dist together

# Apply migrations against the production database (root script covers dev
# migrations; deploy uses the backend workspace directly since it's a
# one-shot, no-diffing apply)
npm run prisma:deploy -w backend

# Backend: run the compiled server
npm run start:prod -w backend

# Frontend: frontend/dist is the static output — deploy it to the static host
```

## Post-deploy smoke test

Walk through the [Final Acceptance Test] scenario from the original spec: log in on a mobile device, search an employee, record ENTRY then EXIT then ENTRY then EXIT, confirm the dashboard shows all four records correctly, then email that day's record to the employee and confirm the email arrives with a correct PNG attachment.
