# Security Model

## Authentication

- Session cookies, not JWT (see [decisions.md](./decisions.md#auth-session-cookies-not-jwt)). `express-session` backed by a Postgres table (`connect-pg-simple`), cookie name `adage.sid`.
- Cookie flags: `httpOnly` (JS can't read it), `sameSite: 'lax'`, `secure: true` when `NODE_ENV=production` (requires HTTPS).
- Passwords hashed with **Argon2** (`argon2` package) — never stored or logged in plaintext.
- Login is rate-limited to 5 attempts per 60 seconds per IP (`@nestjs/throttler`) to blunt brute-force attempts.
- `deserializeUser` re-fetches the user (including role + permissions) from the database on **every request** — a deactivated account or a role change takes effect on the very next request, not at next login.

## Authorization

- Every controller route that isn't `auth/login`/`auth/me` sits behind `SessionAuthGuard` (must be logged in) and `PermissionsGuard` (must hold the permission(s) declared via `@RequirePermissions(...)`).
- **The frontend hiding a button is never treated as security.** Roles now hold different permissions (see below), but every route's `PermissionsGuard` check runs server-side regardless of what the UI shows or hides — this was exactly the point of building the permission-table/guard infrastructure early: narrowing access later (which has already happened once) is a data change to `role_permissions`, not a rewrite of every endpoint.
- **Current role → permission mapping** (narrowed 2026-09-04; HR recording permissions removed 2026-09-10): `SECURITY` = `RECORD_ENTRY`, `RECORD_EXIT`, `VIEW_DASHBOARD`, `VIEW_EMPLOYEE_HISTORY`, `SEND_EMAIL`, `DOWNLOAD_REPORT`. `HR` = `VIEW_DASHBOARD`, `VIEW_EMPLOYEE_HISTORY`, `SEND_EMAIL`, `DOWNLOAD_REPORT`, `MANAGE_EMPLOYEES` — no recording permissions; HR lands on the Dashboard on login. `ADMIN` = every permission.
- Permission list lives in one place: `backend/src/common/constants/permissions.ts`. The seed script and the guards both read from it, so they can't drift out of sync.

## Data protection

- Employee movement data is private company information — no endpoint is publicly reachable; all require an authenticated session.
- Generated PNG/PDF reports are **never** served through predictable public URLs. On-demand downloads stream through an authenticated endpoint; emailed reports are stored in S3-compatible storage with no public ACL, retrievable only via a short-lived signed URL (`StorageService.getSignedDownloadUrl`, 5-minute expiry).
- CORS is locked to `FRONTEND_URL` — no wildcard origins.
- Helmet sets standard security headers on every response.
- Input validation: every DTO uses `class-validator` decorators; `ValidationPipe({ whitelist: true, transform: true })` is applied globally, so unexpected fields in a request body are stripped rather than silently accepted. Every numeric route/query param (`:id`, `skip`, `take`, etc.) is validated via `ParseIntPipe`/`parseOptionalInt` rather than a raw `Number()`, so a malformed value returns a clean 400 instead of an unhandled 500. `PUT /settings/:key` only accepts a fixed whitelist of known keys.
- **Row Level Security enabled on every application table** (Supabase Postgres, 2026-09-09) with no policies defined — a second layer of default-deny below the application layer. The runtime-created `session` table is not present when migrations run and is therefore excluded from that migration. The app's Prisma connection uses the table-owner role, which Postgres always exempts from RLS, so this has zero effect on normal app behavior; it only matters if some other credential (e.g. a Supabase API key) ever touches the database directly. See [decisions.md](./decisions.md#row-level-security-defense-in-depth).
- **Email-sending credential still needs mailbox scoping.** The Azure AD app used for the Microsoft Graph API holds `Mail.Send` as an *application* permission. Admin consent is complete, but the Exchange Online application access policy (`New-ApplicationAccessPolicy`) must still be applied and verified so a compromised client secret cannot send as an arbitrary employee or executive mailbox. See `docs/email-m365-admin-handoff.md`.

## Audit trail

Every sensitive action writes to `audit_logs` (see [database-schema.md](./database-schema.md#audit_logs) for the full action list): logins/logouts, every ENTRY/EXIT, every correction, every employee/user create-update-deactivate, every settings change, every email send attempt (success or failure). Audit rows are never deleted or edited by application code.

## Self-service password reset

- `POST /auth/forgot-password` / `POST /auth/reset-password` (2026-09-10) — a single-use, SHA-256-hashed, 1-hour-expiring token, generated server-side and never stored in plaintext. The request endpoint always returns the same generic response regardless of whether the email matched an account, so it can't be used to enumerate which addresses have accounts. See [decisions.md](./decisions.md#forgot-password-hashed-single-use-tokens-not-jwt-or-plaintext).

## What's NOT yet implemented (see [roadmap.md](./roadmap.md))

- HTTPS termination is assumed to happen at the hosting layer (Vercel/Render/etc.) — not configured in this repo.
- No automated dependency vulnerability scanning is wired into CI yet; the existing CI runs lint, tests, and builds.
- No documented incident-response runbook.

## Reporting a vulnerability

There is no public bug bounty; report security concerns directly to the project's technical owner rather than filing a public GitHub issue, until a formal disclosure process is set up.
