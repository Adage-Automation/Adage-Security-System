# Adage Security System

A responsive web application (installable as a PWA) for recording and managing employee entry/exit movements at Adage, replacing the manual security register.

## Overview

Security personnel search for an employee, then record an **ENTRY** or **EXIT** with one tap. Every movement is stored as an individual event — an employee can have any number of entries/exits per day. Authorized users (Security/HR/Admin, with role-based access — see below) can browse historical records on a dashboard and, only on explicit request, email an employee their movement record for a given day as a PNG attachment.

**This is a secondary/backup attendance record, not the primary one.** Employees already punch their own attendance in a separate app, FactoHR. This system exists because security guards independently note entry/exit times at the gate — if an employee forgets to punch in FactoHR, HR can pull the guard-recorded time here as a fallback/reconciliation source for that dispute or gap. It is not meant to replace FactoHR as the attendance system of record.

Key principles carried through the whole design:
- **Event log, not slots** — one row per movement, never `morning_entry`/`lunch_exit` columns.
- **Server-authoritative timestamps** — the frontend never supplies the official time or user identity.
- **Email is strictly on-demand** — never automatic, never triggered by recording a movement.
- **Working hours displayed on the day view** — the employee details page shows total working hours (first entry → last exit) as a convenience summary; movements are still stored as individual events, not time-slots.
- **Append-only corrections** — a correction never overwrites history; the original row is marked superseded and a new linked record is added.

## Features

- Session-based authentication with role-based access: SECURITY (record movements + Dashboard), HR (Dashboard + Employees — no recording, lands on the Dashboard after login), ADMIN (everything, plus Users/Corrections/Audit Log/Settings) — see [docs/decisions.md](./docs/decisions.md)
- Fast, touch-friendly Security screen: search → select → ENTRY/EXIT → done
- Duplicate-movement confirmation (e.g. pressing ENTRY when already marked inside)
- Dashboard with date / employee / movement-type filters, daily summary stats, responsive table→card layout on mobile
- Employee daily movement details, with on-demand **EMAIL DETAILS**; PNG/PDF report downloads remain authenticated API endpoints and are not exposed as UI buttons
- Employee & user management, with inline edit, employee deactivation (soft, not delete), an optional car number field (searchable alongside name/code/email), and admin-only access to inactive employees for record corrections
- Configurable system settings (company name, timezone, security email, sender name)
- Full audit logging of logins, movements, corrections, emails, and admin actions
- Offline queueing: a movement tapped while offline is queued client-side and synced automatically once connectivity returns, always shown distinctly as "pending sync"
- Installable PWA (manifest + service worker)

## Technology Stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite, `vite-plugin-pwa` (installable PWA + service worker), IndexedDB (offline movement queue), plain `fetch` wrapper with `AbortController` request timeouts — no axios/react-query |
| Backend | NestJS + TypeScript, `class-validator`/`class-transformer` for request validation, `@nestjs/throttler` for login rate limiting |
| Authorization | Custom RBAC — permission-table + guards (`SessionAuthGuard`, `PermissionsGuard`, `@RequirePermissions`), not a third-party ACL library |
| Database | PostgreSQL — **Supabase, Mumbai (ap-south-1)** (see [docs/decisions.md](./docs/decisions.md#database-provider-supabase-mumbai)), Row Level Security enabled on every table |
| ORM | Prisma |
| Auth | Session cookies (`express-session` + `passport-local`, session store in Postgres via `connect-pg-simple`), Argon2 password hashing |
| Email | Microsoft Graph API (OAuth2 client-credentials) through Adage's existing Microsoft 365 tenant — no SMTP, no third-party email vendor — see `docs/email-m365-admin-handoff.md` |
| Report rendering | Puppeteer (HTML/CSS template → PNG/PDF), one pooled browser instance reused across requests |
| Object storage | Supabase Storage (S3-compatible, via `@aws-sdk/client-s3`, bundled with the same project) — only for reports that were actually emailed |
| Monorepo tooling | npm workspaces — one install, one `npm run dev` runs both apps |
| Testing | Jest unit tests in backend/frontend (`npm test`), an e2e command scaffold (`npm run test:e2e`), and CI on every push/PR |

## Architecture

```
Frontend (React/PWA) ── HTTPS ── Backend (NestJS REST API)
                                        │
                        ┌───────────────┼────────────────┐
                        ▼               ▼                ▼
                   PostgreSQL     Email (Graph)    S3-compatible storage
                   (Prisma)                        (emailed reports only)
```

Backend modules: `auth`, `users`, `roles`, `permissions`, `employees`, `movements`, `dashboard`, `reports`, `email`, `audit-logs`, `settings`.

## Database Setup

1. Create a [Supabase](https://supabase.com) project in the **Mumbai (ap-south-1)** region (see [docs/deployment.md](./docs/deployment.md#setting-up-supabase) for step-by-step details, including reusing the same project for report storage).
2. Copy `backend/.env.example` to `backend/.env` and fill in `DATABASE_URL` (from Supabase's connection string) and the other variables.
3. From the repo root:
   ```
   npm install
   npm run prisma:migrate
   npm run seed
   ```

The seed script creates one ADMIN, one HR, and one SECURITY user (all with password `ChangeMe123!` — development-only, change before any shared/production use), plus the roles/permissions/default settings the app needs to function. It does **not** create sample employees or movements — use `npm run import:employees -w backend -- <path-to-csv>` (from the repo root) to load real employee data (see `docs/branding-and-data-needed.md`).

## Environment Variables

See `backend/.env.example` for the full list: `DATABASE_URL`, `SESSION_SECRET`, `APP_TIMEZONE`, `TZ` (set to `Asia/Kolkata` in the host/container runtime), `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/`MAIL_FROM_ADDRESS`/`SECURITY_EMAIL`, and `STORAGE_*` for the S3-compatible bucket used to persist emailed reports. Never commit a real `.env` file.

## Local Development

This is an **npm workspaces** monorepo — one install, one command, from the repo root:

```
npm install    # installs root + backend + frontend, and generates the Prisma client
npm run dev    # runs backend (:4000) and frontend (:5173) together in one terminal
```

Open `http://localhost:5173` — `/api` requests are proxied to the backend automatically. `Ctrl+C` once stops both. See [docs/developer-guide.md](./docs/developer-guide.md) for the full first-time setup (database, `.env`, migrations) and troubleshooting.

## Testing

```
npm test    # from the repo root — runs backend and frontend Jest suites
```
See [docs/testing.md](./docs/testing.md) for the current coverage map and the load-test command. The codebase now includes backend Jest coverage for authentication/password reset, employee search including car number, movements/idempotency/corrections, dashboard queries, RBAC, reports/email failure handling, and storage/report generation paths; the backend also has controller-level specs for Employees and Reports, and the frontend adds coverage for the offline movement queue plus the employee day working-hours calculation. CI (`.github/workflows/ci.yml`) runs lint, tests, and build on every push/PR.

## Build

```
npm run build    # from the repo root — builds backend/dist and frontend/dist together
```

Backend: `backend/dist`, run with `npm run start:prod -w backend`.
Frontend: `frontend/dist`, deployable to any static host (Vercel/Netlify/Cloudflare Pages).

## Deployment

- **Frontend**: Vercel / Netlify / Cloudflare Pages
- **Backend**: Railway / Render / Fly.io / AWS / Azure
- **Database**: Supabase Postgres, Mumbai (ap-south-1), with automated daily backups
- **Storage**: Supabase Storage (same project, S3-compatible)

Always run behind HTTPS in production; the session cookie is marked `secure` when `NODE_ENV=production`.
