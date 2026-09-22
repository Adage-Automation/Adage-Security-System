# Database Schema

Source of truth: `backend/prisma/schema.prisma`. This document explains the *why* behind each table; for exact field types, read the schema file directly.

## Entity relationship overview

```
Role ──< RolePermission >── Permission
  │
  ▼
 User ──< MovementRecord (recordedBy)
  │            │
  │            ├──< MovementRecord (correctedBy)     [self-referential: corrections]
  │            └── MovementRecord.correctionOf ──┘
  │
  ├──< AuditLog
  └──< EmailLog (createdByUser)

Employee ──< MovementRecord
    │
    └──< EmailLog

Setting  (standalone key/value store)
```

## `roles`, `permissions`, `role_permissions`

Classic RBAC join. `roles` seeds `SECURITY`, `HR`, `ADMIN`. `permissions` seeds the fixed list below (`backend/src/common/constants/permissions.ts` is the single source — the seed script reads from it, so it never drifts from the guard code):

```
RECORD_ENTRY
RECORD_EXIT
VIEW_DASHBOARD
VIEW_EMPLOYEE_HISTORY
SEND_EMAIL
DOWNLOAD_REPORT
MANAGE_EMPLOYEES
MANAGE_USERS
MANAGE_SETTINGS
CORRECT_RECORDS
```

`role_permissions` started as "every permission to every role" (v1 default), but was narrowed on 2026-09-04 by explicit request, then narrowed again on 2026-09-10 (HR's recording permissions removed): SECURITY = `RECORD_ENTRY`, `RECORD_EXIT`, `VIEW_DASHBOARD`, `VIEW_EMPLOYEE_HISTORY`, `SEND_EMAIL`, `DOWNLOAD_REPORT`; HR = `VIEW_DASHBOARD`, `VIEW_EMPLOYEE_HISTORY`, `SEND_EMAIL`, `DOWNLOAD_REPORT`, `MANAGE_EMPLOYEES` (no recording); ADMIN = every permission. See `docs/decisions.md` for the mapping and rationale. Restricting a role further is still just a data change — delete rows from `role_permissions` (and update `backend/src/common/constants/permissions.ts` `DEFAULT_ROLE_PERMISSIONS` so a fresh `npm run seed` matches) — nothing in endpoint code changes.

## `users`

One row per login account. `passwordHash` is Argon2 — never store or log a plaintext password. `roleId` is a single FK (a user has exactly one role). `isActive = false` disables login without deleting audit/movement history tied to the user. `resetTokenHash`/`resetTokenExpiresAt` (both nullable, `resetTokenHash` unique) back the self-service "forgot password" flow — only the SHA-256 hash of the reset token is stored, never the raw token; a new request overwrites the previous token (at most one active reset per user); both are cleared on a successful reset. See [decisions.md](./decisions.md#forgot-password-hashed-single-use-tokens-not-jwt-or-plaintext).

## `employees`

The people being tracked — distinct from `users` (a guard is a `User`; the people they check in are `Employee` rows, and usually never log in at all). `employeeCode` is the human-facing ID (e.g. `ADG1024`) and is unique **at the DB level case-sensitively**; `EmployeesService` additionally checks both `employeeCode` and `email` for a case-insensitive duplicate before create/update (app-level, not a DB constraint — search everywhere already matches case-insensitively, so this closes a gap where "EMP001"/"emp001" could otherwise both exist). `email` and `carNumber` are nullable because those details may be added later; `email` has no DB uniqueness constraint at all, only the app-level check above. `carNumber` is mapped to the `car_number` column and indexed for case-insensitive employee search. `isActive = false` (never a hard delete) hides the employee from the guard's search but keeps all historical `movement_records` intact and keeps them selectable in the admin correction flow.

## `movement_records` — the core table

One row **per movement event**. This is deliberately an event log, not a slot-based row (`morning_entry`, `lunch_exit`, etc.) — see [decisions.md](./decisions.md#event-log-not-slots). An employee can have unlimited ENTRY/EXIT rows on the same day.

Key fields:
- `movementType`: `ENTRY` | `EXIT`
- `movementAt`: server-generated timestamp for a live tap — **never** trust a client-supplied time there. The one exception is a record synced from the offline queue: see `recordedOffline` below and [decisions.md](./decisions.md#offline-sync-preserve-the-real-tap-time-within-bounds).
- `recordedOffline`: `false` unless `movementAt` came from the guard's device (offline-queue sync) instead of the server clock at creation time, and only when that client-supplied time passed a plausibility check (not more than 7 days in the past, not more than 5 minutes in the future). Surfaced in the UI as a small "offline" badge next to the time wherever movement records are listed.
- `recordedByUserId`: which logged-in user (almost always SECURITY) tapped the button
- `isSuperseded` / `correctionOfId` / `correctedByUserId` / `correctionReason`: the append-only correction chain. A correction never updates `movementType`/`movementAt` in place — it flags the original `isSuperseded = true` and inserts a new row pointing back at it. All "current" queries filter `isSuperseded: false`.

Indexes: `(employeeId, movementAt)` composite (the hot path — "this employee's history"), plus single-column indexes on `movementAt`, `movementType`, `recordedByUserId`, `isSuperseded`.

## `email_logs`

One row per **on-demand** email send attempt (never per movement — email is strictly on-demand throughout this system, see spec §29/§66 and `docs/architecture.md`'s key design decisions). `status` moves `PENDING → SENT` or `PENDING → FAILED` on any send failure, including a rejected Microsoft Graph send, not just a network-level exception — see `CHANGELOG.md`. `reportFileUrl` points at the S3-compatible object that was actually attached to the email, persisted specifically so a "I never got that email" dispute can be resolved by re-serving the exact file that was sent — see [decisions.md](./decisions.md#report-storage-persist-emailed-reports).

## `audit_logs`

Append-only trail of every sensitive action: `USER_LOGIN`, `USER_LOGOUT`, `ENTRY_RECORDED`, `EXIT_RECORDED`, `RECORD_CORRECTED`, `MISSING_RECORD_ADDED`, `EMPLOYEE_CREATED/UPDATED/DEACTIVATED/REACTIVATED`, `USER_CREATED/UPDATED/ENABLED/DISABLED/PASSWORD_RESET`, `PASSWORD_RESET_REQUESTED` (self-service forgot-password request — logged only when the email matched a real account, to avoid audit-log noise from arbitrary addresses), `EMAIL_SENT`, `EMAIL_FAILED`, `REPORT_DOWNLOADED`, `SETTING_UPDATED`. `oldValue`/`newValue` are compact, sanitized JSON snapshots for before/after diffing; the backend strips sensitive keys (passwords, tokens, session material, raw request bodies) and keeps employee/user summaries intentionally small instead of storing full nested objects. `userId` is nullable so system-triggered events (if any are added later) don't require a synthetic user.

## `settings`

Plain key/value table (`key` is the primary key). Avoids hard-coding `COMPANY_NAME`, `TIMEZONE`, `SECURITY_EMAIL`, `EMAIL_SENDER_NAME` anywhere in application code — see [decisions.md](./decisions.md#securitycc-email-single-global-setting).

## `session` (created automatically)

Not in `schema.prisma` — created at runtime by `connect-pg-simple` (`createTableIfMissing: true` in `backend/src/main.ts`) to back Express sessions in Postgres instead of memory, so sessions survive backend restarts and work across multiple backend instances.

## Migrations

```
npm run prisma:migrate         # dev: creates a new migration from schema changes (root script)
npm run prisma:deploy -w backend  # prod: applies existing migrations, no schema diffing
```

Never edit a migration file that has already been applied in any shared environment — create a new migration instead.
