# Architecture

## System overview

```
                    INTERNET
                       │
                    HTTPS/TLS
                       │
                       ▼
            ┌───────────────────────┐
            │   FRONTEND (PWA)      │
            │ React + TS + Vite     │
            │ installable, offline  │
            │ queue via IndexedDB   │
            └──────────┬────────────┘
                       │ REST (fetch, credentials: include)
                       ▼
            ┌───────────────────────┐
            │   BACKEND (NestJS)    │
            │ session auth, RBAC    │
            │ guards on every route │
            └──────────┬────────────┘
         ┌──────────────┼───────────────┐
         ▼              ▼               ▼
   ┌───────────┐  ┌────────────┐  ┌─────────────┐
   │ PostgreSQL│  │  SMTP      │  │ S3-compatible│
   │ (Prisma)  │  │  (M365)    │  │  storage     │
   │ + sessions│  │            │  │ (emailed     │
   │   table   │  │            │  │  reports     │
   └───────────┘  └────────────┘  │  only)       │
                                   └─────────────┘
```

The frontend never talks to Postgres, the SMTP server, or storage directly — everything routes through the NestJS API, and every API route re-verifies authentication and permission server-side (never trust the UI to hide a button as the only access control).

## Backend module layout

```
backend/src/
├── auth/            session login/logout/me, passport-local strategy, session serializer
├── users/           user CRUD, enable/disable, password reset (ADMIN-facing)
├── roles/           read-only role listing (SECURITY / HR / ADMIN)
├── permissions/     read-only permission listing
├── employees/       employee CRUD, search (active-only for guards, all for corrections)
├── movements/       the event log: create (with duplicate-confirm), list/filter, correct
├── dashboard/       daily summary stats (counts only, no working-hours math)
├── reports/         PNG/PDF generation (Puppeteer) + on-demand email orchestration
├── email/           SMTP wrapper (nodemailer, via Adage's Microsoft 365 tenant) — the only place that sends email
├── audit-logs/      write-through audit trail, read endpoint for admins
├── settings/        key/value system config (company name, timezone, security email, sender name)
├── common/          shared decorators (CurrentUser, RequirePermissions), guards, permission constants
└── prisma/          PrismaService — single DB client, globally injected
```

Each module is self-contained: a `*.module.ts`, `*.controller.ts` (HTTP layer + guards), `*.service.ts` (business logic + Prisma calls), and `dto/*.ts` (request validation via `class-validator`). No module reaches into another module's Prisma queries directly — cross-module needs go through the other module's exported service (e.g. `dashboard` imports `MovementsModule` and calls `MovementsService`).

## Request lifecycle

1. Request hits NestJS behind Helmet + CORS (locked to `FRONTEND_URL`).
2. `express-session` (backed by a Postgres session table via `connect-pg-simple`) resolves the session cookie to a user id.
3. Passport's `deserializeUser` re-fetches the user + role + permissions from the DB on **every request** — so a deactivated user or changed role takes effect immediately, not at next login.
4. `SessionAuthGuard` rejects unauthenticated requests.
5. `PermissionsGuard` reads the `@RequirePermissions(...)` metadata on the route and checks it against `request.user.permissions`.
6. Controller delegates to a service method; the service is the only thing that touches Prisma.
7. State-changing actions call `AuditLogService.record(...)` before returning.

## Frontend structure

```
frontend/src/
├── api/client.ts        thin fetch wrapper, always sends cookies, throws ApiError
├── auth/AuthContext.tsx React context: current user, login/logout, permission check
├── offline/movementQueue.ts  IndexedDB-backed queue for offline ENTRY/EXIT taps
├── components/           Header, ProtectedRoute
├── pages/
│   ├── Login.tsx
│   ├── SecurityHome.tsx   the core guard workflow: search → select → ENTRY/EXIT
│   ├── Dashboard.tsx      date/employee/movement-type filters + summary + records
│   ├── EmployeeDetails.tsx  one employee's day: view, download, EMAIL DETAILS
│   ├── Employees.tsx      admin: employee CRUD, deactivate/reactivate, search + pagination over the full roster
│   ├── Users.tsx          admin: user CRUD, enable/disable
│   ├── Corrections.tsx    admin: search a date + employee, append-only-correct or add a missing record
│   ├── AuditLog.tsx       admin: browse the audit trail, filter by entity type / user
│   └── Settings.tsx       admin: company name, timezone, security email, sender name
└── styles/global.css     mobile-first, large touch targets, responsive table→card breakpoint
```

## Key design decisions

See [decisions.md](./decisions.md) for full rationale on each of these.

- **Event log, not slots** — `movement_records` has one row per ENTRY/EXIT. No `morning_entry`/`lunch_exit` columns. Unlimited movements per employee per day.
- **Server-authoritative timestamps** — `movementAt` is always `new Date()` on the server; the client never supplies it.
- **Confirm-before-save duplicate warning** — if a guard's tap would create back-to-back same-type movements, the server returns `requiresConfirmation: true` without writing anything; the client shows a popup and resubmits with `confirmed: true`.
- **Append-only corrections** — fixing a mistake never mutates the original row. The original is flagged `isSuperseded`, and a new row is created and linked via `correctionOfId`. Full history is always reconstructable.
- **On-demand email only** — the only code path that calls `EmailService` is `ReportsService.emailDailyRecord`, invoked only from `POST /reports/email`, invoked only when an authorized user clicks "EMAIL DETAILS" after selecting an employee + date. Nothing in the movement-recording path touches email.
- **Persisted emailed reports** — the PNG that's actually emailed is uploaded to S3-compatible storage and referenced from `email_logs.reportFileUrl`, so a "did I get sent this?" dispute can be resolved by re-serving the exact file. On-demand *downloads* (never emailed) are generated fresh and not stored.
- **Offline queueing** — a movement tapped while offline (or on a failed request) is queued in IndexedDB and shown as "pending sync," never reported as a confirmed save. Sync runs on `online` events and on page load.
- **RBAC scaffolding paid off** — `role_permissions` started as every permission mapped to every role (v1 spec default), but every endpoint was already gated by `@RequirePermissions(...)`. When the roles needed to diverge (2026-09-04: Security limited to the recording workflow + Dashboard, HR gets that plus Employees, only Admin gets Users/Corrections/Audit Log/Settings), it was a data change to `DEFAULT_ROLE_PERMISSIONS` plus reconciling the live `role_permissions` table — zero endpoint code touched.
- **Idempotent movement creation** — `POST /movements` accepts an optional client-generated `clientRequestId`. If the same key arrives twice (an ambiguous network failure where the client retries a request that actually succeeded), the server returns the existing record instead of creating a duplicate. See [decisions.md](./decisions.md#movement-idempotency-key).
- **Database-level defense in depth (RLS)** — every Supabase/Postgres table has Row Level Security enabled with no policies defined. The app's own Prisma connection uses the table-owner role, which Postgres exempts from RLS, so this is invisible to normal app behavior; it exists purely so that any *other* credential (e.g. Supabase's separate `anon`/`authenticated` API roles, never used by this app but present by default in a Supabase project) is denied by default rather than defaulting to full read/write access. See [decisions.md](./decisions.md#row-level-security-defense-in-depth).

## Timezone handling

The application timezone is `Asia/Kolkata` (`APP_TIMEZONE` env var). Day-boundary queries (e.g., "today's records") rely on the **server process** running in that timezone — deploy with `TZ=Asia/Kolkata` set, or the day boundaries will be computed against the server's local time instead. See the note in `backend/src/movements/movements.service.ts`.
