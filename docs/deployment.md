# Deployment

Nothing is deployed yet — this document describes the target architecture and the checklist to follow when it's time. See [roadmap.md](./roadmap.md) for current status.

## Free-tier deployment path (2026)

A fully working, $0/month deployment is realistic for this app's scale (a few hundred employees, internal tool, modest traffic) — every layer already picked (Supabase, Microsoft Graph via Adage's existing 365 tenant) is free at this size, and the remaining two layers (frontend hosting, backend hosting) both have real free options. This is internet-hosted, not a local/LAN server — once deployed, it's reachable from any location with internet access (any gate, any device), which is the whole point of a guard-facing PWA.

**Frontend (static PWA build)** — any of these host it for free, indefinitely, no time limit or spin-down (static files on a CDN, not a server that idles):
- **Cloudflare Pages** — unlimited bandwidth on the free plan, generally the most generous for a low-traffic internal tool.
- **Vercel** or **Netlify** — also genuinely free for a static/PWA build at this traffic level; either works equally well.

**Backend (NestJS API + Puppeteer)** — this is the layer that actually needs an always-running process, and free options differ a lot here. As of 2026:
- **Render's free tier** exists but the web service spins down after 15 minutes of inactivity, with a 30–60 second cold start on the next request. That's a real problem for a guard tapping ENTRY/EXIT at the gate and expecting an instant response — workable for a demo/staging deploy, not recommended as the primary production deploy.
- **Railway** no longer has a real ongoing free tier — new accounts get a one-time $5 trial credit, then drop to $1/month of credit, which isn't enough for an always-on service with a database-adjacent workload.
- **Fly.io** removed its free allowance in 2024 — new accounts only get a short trial before requiring a card.
- **Oracle Cloud "Always Free"** is the strongest genuinely-free option: a real, always-on VM with no spin-down, no trial expiry — currently 2 ARM (Ampere A1) OCPUs + 12 GB RAM (or split across VMs), 200 GB disk, 10 TB/month egress, or two small AMD micro VMs (1 GB RAM each) as a fallback if ARM capacity isn't available at signup in your region (a known, occasional Oracle sign-up friction point). This comfortably runs the NestJS backend plus Puppeteer's Chromium (which needs roughly 1–2 GB per report-generation call) with process-manager (e.g. `pm2`) keeping it always running — no cold starts.
- Whichever backend host is used, terminate TLS in front of it (Oracle: a free Let's Encrypt cert via `certbot`, or put Cloudflare's free plan in front of the VM for HTTPS + a real hostname without paying for a domain's DNS/SSL separately).

**Database + object storage** — already decided: **Supabase free tier** (`ap-south-1`, Mumbai) — 500 MB database, 1 GB file storage, both comfortably enough for this app's scale for a good while. One free-tier quirk to plan around: a free Supabase project auto-pauses after 7 days with no database request and needs a manual unpause from the dashboard — avoid this with a scheduled free **GitHub Actions** workflow (or UptimeRobot's free tier) that pings a health endpoint daily, which incidentally also keeps the backend warm if it's on a host that would otherwise idle.

**Email** — already free: Microsoft Graph API through Adage's own Microsoft 365 tenant, no separate email-vendor cost.

**Putting it together at $0/month**: Cloudflare Pages (frontend) + Oracle Cloud Always Free VM (backend, `pm2`-managed) + Supabase free tier (database + storage) + Microsoft Graph (email) + a free GitHub Actions cron to prevent both the backend and Supabase from ever idling. The only recurring cost this doesn't cover is a custom domain name (a domain registrar isn't free anywhere) — Cloudflare Pages/Vercel/Netlify and Oracle's VM all work fine on their provider-issued subdomain/IP if a custom domain isn't needed yet.

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
- [ ] Puppeteer's Chromium dependency is available in the deploy target (some serverless/container platforms need extra config or a Puppeteer-compatible buildpack — verify report generation works in a staging deploy before going live)
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
