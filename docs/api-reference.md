# API Reference

All routes are prefixed with `/api`. Auth is session-cookie based (`credentials: 'include'` required on every fetch). Every route below except `POST /auth/login`, `POST /auth/forgot-password`, `POST /auth/reset-password`, and `GET /health` requires an authenticated session; routes also list the permission enforced by `PermissionsGuard`. Roles hold different permission sets (see `docs/security.md` for the current mapping) — the guard check always runs regardless of role.

## Health

### `GET /health`
No auth required. Runs a real `SELECT 1` against the database and returns `{ status: 'ok', time: ISOString }`, or `503` if the database is unreachable. Two purposes: the frontend's real server-reachability check (`frontend/src/api/health.ts`, polled from `SecurityHome.tsx` — distinguishes "server unreachable" from `navigator.onLine`'s link-only signal), and an external keep-alive target (`.github/workflows/keep-alive.yml`, plus an external uptime monitor if one is configured) to stop Render's free tier sleeping and Supabase's free tier auto-pausing. See `docs/deployment.md`.

## Auth

### `POST /auth/login`
Body: `{ username: string, password: string }` — despite the field name, `username` accepts either the account's username or its email (email match is case-insensitive; username match is exact, consistent with its case-sensitive DB uniqueness). See `docs/decisions.md`.
Rate-limited to 5 attempts/60s per IP. Returns `{ user: AuthUser }` on success, `401` on bad credentials, `429` if rate-limited.

### `POST /auth/logout`
No body. Destroys the session, clears the cookie.

### `GET /auth/me`
Returns `{ user: AuthUser }` for the current session, or `401` if not logged in.

`AuthUser` shape: `{ id, name, email, username, role, permissions: string[] }`

### `POST /auth/forgot-password`
Body: `{ email: string }`. Rate-limited to 5 attempts/60s per IP. Always returns `200 { message }` with the same generic wording regardless of whether the email matched an account — never reveals which addresses have accounts. If it matches an active user, emails them a single-use reset link (expires in 1 hour).

### `POST /auth/reset-password`
Body: `{ token: string, newPassword: string }` (`newPassword` min 8 characters). Rate-limited to 5 attempts/60s per IP. `200 { message }` on success. `400` if the token is missing, malformed, expired, or already used.

## Employees

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/employees/search?q=` | `VIEW_DASHBOARD` | Active employees only, top 10 matches, name/code/email/car number, case-insensitive. Backs both the guard's ENTRY/EXIT selector and the Dashboard's employee filter — every role that reaches either already holds `VIEW_DASHBOARD`. A blank/omitted `q` returns the first 10 active employees alphabetically (a "browse" list) rather than an empty array — the frontend fetches this on focus, before any typing, so the dropdown isn't empty until something's typed. See `docs/decisions.md`. |
| GET | `/employees/search-all?q=` | `CORRECT_RECORDS` | Includes inactive employees — for the admin correction flow; searches name/code/email/car number. Same blank-query browse-list behavior as `/employees/search` above. |
| GET | `/employees/offline-cache` | `VIEW_DASHBOARD` | Full active roster (id/name/code/email/car number only, no take limit) — backs the Security app's offline search fallback (`frontend/src/offline/employeeCache.ts`). The frontend fetches this on load and every 5 minutes while online and caches it in `localStorage`, since `/employees/search` above is `NetworkOnly` in the service worker and unreachable while genuinely offline. See `docs/decisions.md`. |
| GET | `/employees?skip=&take=&q=` | `MANAGE_EMPLOYEES` | Admin management list. `q` (optional) filters name/code/email/car number, case-insensitive. Returns `{ rows: Employee[], total: number }` — `total` reflects the filtered count, so the frontend can page/search the full roster rather than being capped at one page. |
| GET | `/employees/:id` | `VIEW_EMPLOYEE_HISTORY` | Single-employee lookup — intentionally not gated behind `MANAGE_EMPLOYEES`, since it backs the Employee Details page that Security/HR reach via the Dashboard even though they lack `MANAGE_EMPLOYEES` |
| POST | `/employees` | `MANAGE_EMPLOYEES` | Body: `CreateEmployeeDto` |
| PUT | `/employees/:id` | `MANAGE_EMPLOYEES` | Body: `UpdateEmployeeDto` |
| PATCH | `/employees/:id/deactivate` | `MANAGE_EMPLOYEES` | Soft — sets `isActive: false` |
| PATCH | `/employees/:id/reactivate` | `MANAGE_EMPLOYEES` | |

`CreateEmployeeDto`: `{ employeeCode, employeeName, email?, phone?, department?, designation?, carNumber? }` — `email` and `carNumber` are optional. When email is omitted, that employee simply can't be emailed a report until one is added. `carNumber` is searchable and displayed where employee details are shown. `department`/`designation` are accepted but unused by any search/filter/report — kept only because the DB columns still exist.

`employeeCode` and `email` are checked for a case-insensitive duplicate on both create and update (`PUT /employees/:id`) and return `409` with a message naming the conflicting employee (for email) — closes a gap where the DB's own uniqueness constraint on `employeeCode` is case-sensitive while every search matches case-insensitively, and `email` had no DB uniqueness constraint at all. See `docs/decisions.md`.

## Movements

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/movements` | `RECORD_ENTRY` \| `RECORD_EXIT` | See below |
| GET | `/movements?date=&employeeId=&movementType=` | `VIEW_DASHBOARD` | All filters optional |
| GET | `/movements/employee/:id?date=` | `VIEW_EMPLOYEE_HISTORY` | One employee's movements for one date |
| POST | `/movements/:id/correct` | `CORRECT_RECORDS` | Append-only correction (see below) |
| POST | `/movements/missing` | `CORRECT_RECORDS` | Adds a movement that was never recorded at all |

### `POST /movements` — creating a movement

Body: `{ employeeId: number, movementType: 'ENTRY' | 'EXIT', confirmed?: boolean, clientRequestId?: string, clientMovementAt?: string }`

`clientRequestId` is an optional client-generated idempotency key, one per guard tap, resent unchanged on any retry of that same tap (including the offline queue's sync retry). If a record already exists for that key, the server returns it instead of creating a duplicate — closes the "request succeeded but the response was lost, so the client retries" duplicate-record risk.

`clientMovementAt` (ISO 8601, optional) is sent only by the offline queue's sync path — the guard's device-captured real tap time. It is **not** trusted outright: the server uses it only if it's within a plausible window (not more than 7 days in the past, not more than 5 minutes in the future); otherwise it falls back to the server clock exactly as if the field had been omitted. A live/online tap never sends this field at all. See [decisions.md](./decisions.md#offline-sync-preserve-the-real-tap-time-within-bounds).

Response is one of:
```json
{ "created": true, "requiresConfirmation": false, "record": { ...MovementRecord } }
```
or, if the employee's last movement is the same type and `confirmed` was not `true`:
```json
{ "created": false, "requiresConfirmation": true, "lastMovementType": "ENTRY" }
```
The client must show a confirmation prompt and resubmit with `confirmed: true` to actually create the record. **The timestamp and recording user are always server-derived for a live tap — never send them in the body.** The one bounded exception is `clientMovementAt` on an offline-queue sync, above. `MovementRecord.recordedOffline` reflects whether that exception actually applied to a given record.

The "read last movement, then write" check above is wrapped in a Postgres advisory lock (`pg_advisory_xact_lock`) scoped to `employeeId`, so two requests for the *same* employee arriving at nearly the same instant (two guards on two different devices) are serialized rather than racing each other into two undetected duplicates — a different employee's request is never blocked by this. See [decisions.md](./decisions.md#offline-sync-preserve-the-real-tap-time-within-bounds).

### `POST /movements/:id/correct`

Body (`CorrectMovementDto`): `{ movementType, employeeId, movementAt (ISO string), correctionReason }`
Marks the record at `:id` as `isSuperseded`, creates a new linked record with the corrected values. Does not delete anything.

### `POST /movements/missing`

Same body shape as above. Adds a brand-new record (no `correctionOf` link) for a movement that was never captured at all.


## Dashboard

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/dashboard/summary?date=` | `VIEW_DASHBOARD` | `{ totalEmployees, totalEntries, totalExits, currentlyInside }` for the given date (defaults to today, computed in IST via `todayInAppTimezone()` — not the UTC calendar date, which would be wrong for the first 5.5 hours of every IST day). `currentlyInside` counts employees whose last movement on that date was ENTRY — a live figure only for today; for a past date it reads as "not exited by end of that day." No working-hours math. |

## Reports & Email

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/reports/image?employeeId=&date=` | `DOWNLOAD_REPORT` | Streams a freshly generated PNG, not persisted. API-only — no download button in the current UI (removed by design decision, 2026-09-03) |
| GET | `/reports/pdf?employeeId=&date=` | `DOWNLOAD_REPORT` | Streams a freshly generated PDF, not persisted. API-only — same as above |
| POST | `/reports/email?employeeId=&date=` | `SEND_EMAIL` | The **only** endpoint that ever sends an email. Persists the PNG to storage, sends via the Microsoft Graph API (Adage's Microsoft 365 tenant, OAuth2), writes an `email_logs` row |
| GET | `/reports/email-logs?employeeId=` | `SEND_EMAIL` | Audit trail of send attempts |
| GET | `/reports/email-logs/:id/download` | `SEND_EMAIL` | Returns a short-lived signed URL for the exact PNG previously attached to that email |

## Users (admin)

| Method | Path | Permission |
|---|---|---|
| GET | `/users` | `MANAGE_USERS` |
| GET | `/users/:id` | `MANAGE_USERS` |
| POST | `/users` | `MANAGE_USERS` |
| PUT | `/users/:id` | `MANAGE_USERS` |
| PATCH | `/users/:id/disable` | `MANAGE_USERS` |
| PATCH | `/users/:id/enable` | `MANAGE_USERS` |
| PATCH | `/users/:id/reset-password` | `MANAGE_USERS` |

`CreateUserDto`: `{ name, email, phone?, username, password, roleId }`

`PUT /users/:id` (`UpdateUserDto`) rejects a duplicate `email` with a clean `409` instead of a raw DB error. `PUT /users/:id` (when changing `roleId`) and `PATCH /users/:id/disable` both reject with `400` if the change would leave zero active users holding `MANAGE_USERS` — prevents a total admin lockout (Users/Settings/Audit Log becoming unreachable by anyone, recoverable only via direct DB access). See `docs/decisions.md`.

## Roles / Permissions (read-only listings)

| Method | Path | Permission |
|---|---|---|
| GET | `/roles` | `MANAGE_USERS` |
| GET | `/permissions` | `MANAGE_USERS` |

## Settings

| Method | Path | Permission |
|---|---|---|
| GET | `/settings` | `MANAGE_SETTINGS` |
| PUT | `/settings/:key` | `MANAGE_SETTINGS` — body `{ value: string }`. `:key` must be one of the known keys (`backend/src/common/constants/settings-keys.ts`: `COMPANY_NAME`, `TIMEZONE`, `SECURITY_EMAIL`, `EMAIL_SENDER_NAME`) — any other key returns 400 |

## Audit Logs

| Method | Path | Permission |
|---|---|---|
| GET | `/audit-logs?entityType=&entityId=&userId=&skip=&take=` | `MANAGE_SETTINGS` | `skip`/`take` for pagination (default `take=50`); response rows include the acting user's `{id, name}` |

## Error shape

Non-2xx responses return `{ statusCode, message, error }` (Nest's default). The frontend's `api/client.ts` throws `ApiError` with `.status` and `.message` extracted from this. `401` → not authenticated (redirect to login). `403` → authenticated but missing permission. `429` → rate-limited (login, forgot-password, and reset-password). `400` → validation failure, including a malformed numeric route/query param (e.g. `GET /employees/abc`) — every `:id` and numeric query param is parsed with `ParseIntPipe` or the `parseOptionalInt` helper, never a raw `Number()` that could reach Prisma and surface as a 500.

A client-side request that takes longer than 20s aborts and throws `ApiTimeoutError` (not an `ApiError`) — see `frontend/src/api/client.ts`.
