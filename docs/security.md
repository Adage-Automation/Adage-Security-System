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
- **Current role → permission mapping** (narrowed from the original flat v1 default on 2026-09-04, by explicit request): `SECURITY` = `RECORD_ENTRY`, `RECORD_EXIT`, `VIEW_DASHBOARD`, `VIEW_EMPLOYEE_HISTORY`, `SEND_EMAIL`, `DOWNLOAD_REPORT` (the core recording workflow plus Dashboard, and the Employee Details/email drill-down reachable from it). `HR` = the same set plus `MANAGE_EMPLOYEES`. `ADMIN` = every permission. See `backend/src/common/constants/permissions.ts` (`DEFAULT_ROLE_PERMISSIONS`) for the source of truth, and `docs/decisions.md` for the rationale.
- Permission list lives in one place: `backend/src/common/constants/permissions.ts`. The seed script and the guards both read from it, so they can't drift out of sync.

## Data protection

- Employee movement data is private company information — no endpoint is publicly reachable; all require an authenticated session.
- Generated PNG/PDF reports are **never** served through predictable public URLs. On-demand downloads stream through an authenticated endpoint; emailed reports are stored in S3-compatible storage with no public ACL, retrievable only via a short-lived signed URL (`StorageService.getSignedDownloadUrl`, 5-minute expiry).
- CORS is locked to `FRONTEND_URL` — no wildcard origins.
- Helmet sets standard security headers on every response.
- Input validation: every DTO uses `class-validator` decorators; `ValidationPipe({ whitelist: true, transform: true })` is applied globally, so unexpected fields in a request body are stripped rather than silently accepted.

## Audit trail

Every sensitive action writes to `audit_logs` (see [database-schema.md](./database-schema.md#audit_logs) for the full action list): logins/logouts, every ENTRY/EXIT, every correction, every employee/user create-update-deactivate, every settings change, every email send attempt (success or failure). Audit rows are never deleted or edited by application code.

## What's NOT yet implemented (see [roadmap.md](./roadmap.md))

- HTTPS termination is assumed to happen at the hosting layer (Vercel/Render/etc.) — not configured in this repo.
- "Forgot password" has a UI stub only; no backend reset-link flow exists yet.
- No automated dependency vulnerability scanning is wired into CI yet (no CI pipeline exists yet at all).
- No documented incident-response runbook.

## Reporting a vulnerability

There is no public bug bounty; report security concerns directly to the project's technical owner rather than filing a public GitHub issue, until a formal disclosure process is set up.
