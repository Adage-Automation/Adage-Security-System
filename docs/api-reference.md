# API Reference

All routes are prefixed with `/api`. Auth is session-cookie based (`credentials: 'include'` required on every fetch). Every route below except `POST /auth/login` requires an authenticated session; routes also list the permission enforced by `PermissionsGuard`. Roles hold different permission sets (see `docs/security.md` for the current mapping) — the guard check always runs regardless of role.

## Auth

### `POST /auth/login`
Body: `{ username: string, password: string }`
Rate-limited to 5 attempts/60s per IP. Returns `{ user: AuthUser }` on success, `401` on bad credentials, `429` if rate-limited.

### `POST /auth/logout`
No body. Destroys the session, clears the cookie.

### `GET /auth/me`
Returns `{ user: AuthUser }` for the current session, or `401` if not logged in.

`AuthUser` shape: `{ id, name, email, username, role, permissions: string[] }`

## Employees

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/employees/search?q=` | `RECORD_ENTRY` | Active employees only, top 10 matches, name/code/email, case-insensitive |
| GET | `/employees/search-all?q=` | `CORRECT_RECORDS` | Includes inactive employees — for the admin correction flow |
| GET | `/employees` | `MANAGE_EMPLOYEES` | Paginated (`skip`, `take`) |
| GET | `/employees/:id` | `MANAGE_EMPLOYEES` | |
| POST | `/employees` | `MANAGE_EMPLOYEES` | Body: `CreateEmployeeDto` |
| PUT | `/employees/:id` | `MANAGE_EMPLOYEES` | Body: `UpdateEmployeeDto` |
| PATCH | `/employees/:id/deactivate` | `MANAGE_EMPLOYEES` | Soft — sets `isActive: false` |
| PATCH | `/employees/:id/reactivate` | `MANAGE_EMPLOYEES` | |

`CreateEmployeeDto`: `{ employeeCode, employeeName, email, phone?, department?, designation? }`

## Movements

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/movements` | `RECORD_ENTRY` \| `RECORD_EXIT` | See below |
| GET | `/movements?date=&employeeId=&movementType=` | `VIEW_DASHBOARD` | All filters optional |
| GET | `/movements/employee/:id?date=` | `VIEW_EMPLOYEE_HISTORY` | One employee's movements for one date |
| POST | `/movements/:id/correct` | `CORRECT_RECORDS` | Append-only correction (see below) |
| POST | `/movements/missing` | `CORRECT_RECORDS` | Adds a movement that was never recorded at all |

### `POST /movements` — creating a movement

Body: `{ employeeId: number, movementType: 'ENTRY' | 'EXIT', confirmed?: boolean }`

Response is one of:
```json
{ "created": true, "requiresConfirmation": false, "record": { ...MovementRecord } }
```
or, if the employee's last movement is the same type and `confirmed` was not `true`:
```json
{ "created": false, "requiresConfirmation": true, "lastMovementType": "ENTRY" }
```
The client must show a confirmation prompt and resubmit with `confirmed: true` to actually create the record. **The timestamp and recording user are always server-derived — never send them in the body.**

### `POST /movements/:id/correct`

Body (`CorrectMovementDto`): `{ movementType, employeeId, movementAt (ISO string), correctionReason }`
Marks the record at `:id` as `isSuperseded`, creates a new linked record with the corrected values. Does not delete anything.

### `POST /movements/missing`

Same body shape as above. Adds a brand-new record (no `correctionOf` link) for a movement that was never captured at all.

## Dashboard

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/dashboard/summary?date=` | `VIEW_DASHBOARD` | `{ totalEmployees, totalEntries, totalExits, currentlyInside }` for the given date (defaults to today). `currentlyInside` counts employees whose last movement on that date was ENTRY — a live figure only for today; for a past date it reads as "not exited by end of that day." No working-hours math. |

## Reports & Email

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/reports/image?employeeId=&date=` | `DOWNLOAD_REPORT` | Streams a freshly generated PNG, not persisted. API-only — no download button in the current UI (removed by design decision, 2026-09-03) |
| GET | `/reports/pdf?employeeId=&date=` | `DOWNLOAD_REPORT` | Streams a freshly generated PDF, not persisted. API-only — same as above |
| POST | `/reports/email?employeeId=&date=` | `SEND_EMAIL` | The **only** endpoint that ever sends an email. Persists the PNG to storage, sends via SMTP (Adage's Microsoft 365 tenant), writes an `email_logs` row |
| GET | `/reports/email-logs?employeeId=` | `SEND_EMAIL` | Audit trail of send attempts |

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

## Roles / Permissions (read-only listings)

| Method | Path | Permission |
|---|---|---|
| GET | `/roles` | `MANAGE_USERS` |
| GET | `/permissions` | `MANAGE_USERS` |

## Settings

| Method | Path | Permission |
|---|---|---|
| GET | `/settings` | `MANAGE_SETTINGS` |
| PUT | `/settings/:key` | `MANAGE_SETTINGS` — body `{ value: string }` |

## Audit Logs

| Method | Path | Permission |
|---|---|---|
| GET | `/audit-logs?entityType=&entityId=&userId=&skip=&take=` | `MANAGE_SETTINGS` | `skip`/`take` for pagination (default `take=50`); response rows include the acting user's `{id, name}` |

## Error shape

Non-2xx responses return `{ statusCode, message, error }` (Nest's default). The frontend's `api/client.ts` throws `ApiError` with `.status` and `.message` extracted from this. `401` → not authenticated (redirect to login). `403` → authenticated but missing permission. `429` → rate-limited (login only, currently).
