# Developer Guide

## Prerequisites

- Node.js 20+ (developed against Node 22)
- PostgreSQL 14+ (local install, Docker, or a hosted instance like Supabase/Neon/Railway)
- npm

## First-time setup

```bash
# 1. Database
#    Provision a Supabase project (Mumbai/ap-south-1 region) — see
#    docs/deployment.md#setting-up-supabase — or point at any local/other
#    Postgres instance for pure local dev. Note the connection string.

# 2. Backend
cd backend
cp .env.example .env
# edit .env: at minimum set DATABASE_URL, SESSION_SECRET
npm install
npm run prisma:migrate     # creates tables
npm run seed                # creates dev users + sample data
npm run start:dev           # http://localhost:4000, API at /api

# 3. Frontend (separate terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173, proxies /api to :4000
```

Seeded dev logins (never reuse these credentials outside local development): `admin` / `hr` / `security`, all with password `ChangeMe123!`.

## Repo layout

```
backend/     NestJS API — see docs/architecture.md#backend-module-layout
frontend/    React PWA  — see docs/architecture.md#frontend-structure
docs/        this documentation
README.md    tech stack + quick start
CHANGELOG.md dated log of changes
```

## Adding a new backend feature

Follow the existing module pattern (e.g. copy `employees/` as a template):

1. `dto/*.ts` — request shape with `class-validator` decorators.
2. `*.service.ts` — business logic, all Prisma calls, calls `AuditLogService.record(...)` for anything state-changing.
3. `*.controller.ts` — HTTP routes, `@UseGuards(SessionAuthGuard, PermissionsGuard)` at the class level, `@RequirePermissions(...)` per route. Add a new permission to `common/constants/permissions.ts` first if the feature needs one, then decide which role(s) get it in `DEFAULT_ROLE_PERMISSIONS` — roles are no longer flat (see `docs/decisions.md`), so pick deliberately rather than defaulting to "all three." If you change `DEFAULT_ROLE_PERMISSIONS`, remember it only affects `npm run seed` going forward — a live database's `role_permissions` table won't update itself; reconcile it directly (see the CHANGELOG entry for 2026-09-04 for the pattern used last time).
4. `*.module.ts` — wire it up, export the service if another module needs it.
5. Register the module in `app.module.ts`.
6. If it touches the DB schema, update `prisma/schema.prisma`, run `npm run prisma:migrate`, and update `docs/database-schema.md`.

## Adding a new frontend page

1. Add the component under `src/pages/`.
2. Add a `<Route>` in `App.tsx`, wrapped in `<ProtectedRoute>` unless it's meant to be public.
3. Use `api` from `src/api/client.ts` for all requests — never `fetch` directly, so error handling stays consistent.
4. Reuse the CSS classes in `src/styles/global.css` rather than inventing new ones where an existing pattern fits (`.big-button`, `.status-banner`, `.filters-bar`, `.records-table` / `.record-cards` for the responsive table→card pattern).

## Conventions

- **Never trust the client for a timestamp, user identity, or permission check.** The server is always authoritative — see `docs/architecture.md`.
- **State-changing actions must call `AuditLogService.record(...)`.** Look at any existing service method for the pattern.
- **Corrections to `movement_records` are append-only.** Never write code that does `prisma.movementRecord.update()` to change `movementType` or `movementAt` on an existing row — use the supersede-and-insert pattern in `MovementsService.correctMovement`.
- **No working-hours calculations anywhere** — this is an explicit, permanent scope exclusion (see spec / `docs/decisions.md`).
- **No keyboard shortcuts for state-changing actions.**
- DTOs use `strictPropertyInitialization: false` (set in `backend/tsconfig.json`) since `class-validator` DTOs are populated by the framework, not a constructor — don't "fix" this by adding constructors or `!` assertions project-wide.

## Building

```bash
cd backend && npm run build     # -> backend/dist
cd frontend && npm run build    # -> frontend/dist (tsc -b && vite build)
```

Both must build with zero TypeScript errors before merging — this is currently manually verified; see `docs/roadmap.md` for wiring up CI.

## Environment variables

Full reference lives in `backend/.env.example`. Never commit a real `.env`. Key ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Signs the session cookie — long random string, unique per environment |
| `APP_TIMEZONE` | Should stay `Asia/Kolkata`; also set the OS-level `TZ` on the backend process (see architecture doc's timezone note) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP config — Adage's Microsoft 365 tenant, see `docs/email-m365-admin-handoff.md` |
| `EMAIL_FROM` / `SECURITY_EMAIL` | Sender display name and CC address |
| `STORAGE_*` | S3-compatible bucket for persisted emailed reports |
| `FRONTEND_URL` | Used for CORS allow-list |

## Where things live if you're debugging

| Symptom | Look here |
|---|---|
| Login always fails | `backend/src/auth/auth.service.ts` (`validateUser`), check `passwordHash`/seed |
| A route returns 403 for a role that should have access | `common/constants/permissions.ts` `DEFAULT_ROLE_PERMISSIONS`, and whether seed was re-run after adding a new permission |
| Movement not saving, no error shown | Check `frontend/src/offline/movementQueue.ts` — it may have silently queued rather than failed; check IndexedDB in devtools |
| Email not sending | `backend/src/reports/reports.service.ts` `emailDailyRecord`, then `backend/src/email/email.service.ts`; check `email_logs.status`/`errorMessage` |
| PNG/PDF looks wrong | `backend/src/reports/report.template.ts` (the HTML) and `report-generator.service.ts` (Puppeteer rendering) |
| Day boundary off by a few hours | Server `TZ` isn't set to `Asia/Kolkata` — see architecture doc's timezone note |
