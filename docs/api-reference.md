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
| GET | `/employees/search-all?q=` | `CORRECT_RECORDS` | Includes inactive employees — for the Missing Movements page (Security/Admin); searches name/code/email/car number. Same blank-query browse-list behavior as `/employees/search` above. |
| GET | `/employees/teams` | `VIEW_DASHBOARD` | Returns the fixed `TEAMS` list (`backend/src/common/constants/teams.ts`) as a plain `string[]` — backs the Add/Edit Employee "Team" dropdown and the Insights team filter. `VIEW_DASHBOARD`, not `MANAGE_EMPLOYEES` — this is just a static list of team names, not sensitive employee data, and the Insights filter (`VIEW_REPORTS`) doesn't hold `MANAGE_EMPLOYEES`. |
| GET | `/employees/offline-cache` | `VIEW_DASHBOARD` | Full active roster (id/name/code/email/car number only, no take limit) — backs the Security app's offline search fallback (`frontend/src/offline/employeeCache.ts`). The frontend fetches this on load and every 5 minutes while online and caches it in `localStorage`, since `/employees/search` above is `NetworkOnly` in the service worker and unreachable while genuinely offline. See `docs/decisions.md`. |
| GET | `/employees?skip=&take=&q=` | `MANAGE_EMPLOYEES` | Admin management list. `q` (optional) filters name/code/email/car number, case-insensitive. Returns `{ rows: Employee[], total: number }` — `total` reflects the filtered count, so the frontend can page/search the full roster rather than being capped at one page. |
| GET | `/employees/export` | `MANAGE_EMPLOYEES` | Generates a `.xlsx` of the full roster (all employees, active and inactive, with status shown) straight from the database and returns it as a file download (`Content-Disposition: attachment`). Registered before `/employees/:id` so it isn't swallowed by it. On-demand alternative to hand-maintaining `backend/data/employees.csv` in sync with live Add/Edit/Deactivate edits — see `docs/decisions.md`. |
| GET | `/employees/import-template` | `MANAGE_EMPLOYEES` | Returns a blank `.xlsx` with just the import headers (`Employee Code`, `Name`, `Email`, `Car Number`) on an "Employees" tab, plus a separate "Instructions" tab with the format rules and one reference example row — the example is deliberately kept off the data tab so it can never be accidentally imported as a real employee. Registered before `/employees/:id` for the same reason as `/employees/export`. |
| POST | `/employees/import` | `MANAGE_EMPLOYEES` | Multipart upload, field name `file`, `.xlsx` only, 2MB limit (`FileInterceptor`, memory storage — never written to disk). Parses the sheet by header name (column order doesn't matter) and processes rows one at a time, reusing the exact same `create()` path (and its validation/duplicate-check/trim/audit-log) as `POST /employees` below — a bad row (missing code/name, invalid email, a code already taken, an unrecognized Team value) is recorded as skipped with a reason and the rest of the file still imports. An optional `Team` column is matched case-insensitively against the fixed `TEAMS` list and resolved to its canonical casing. Fully blank rows are ignored without being reported. Capped at 1000 data rows per upload. Returns `{ created: number, skipped: number, results: Array<{ row, employeeCode, employeeName, status: 'created' \| 'skipped', reason? }> }`. See `docs/decisions.md`. |
| GET | `/employees/:id` | `VIEW_EMPLOYEE_HISTORY` | Single-employee lookup — intentionally not gated behind `MANAGE_EMPLOYEES`, since it backs the Employee Details page that Security/HR reach via the Dashboard even though they lack `MANAGE_EMPLOYEES` |
| POST | `/employees` | `MANAGE_EMPLOYEES` | Body: `CreateEmployeeDto` |
| PUT | `/employees/:id` | `MANAGE_EMPLOYEES` | Body: `UpdateEmployeeDto`. For `email`/`carNumber`: omit the key to leave the field untouched, send `null` (or a whitespace-only string) to clear it, send a value to set it. See `docs/decisions.md`. |
| PATCH | `/employees/:id/deactivate` | `MANAGE_EMPLOYEES` | Soft — sets `isActive: false` |
| PATCH | `/employees/:id/reactivate` | `MANAGE_EMPLOYEES` | |

`CreateEmployeeDto`: `{ employeeCode, employeeName, email?, carNumber?, team? }` — `email`, `carNumber`, and `team` are optional. When email is omitted, that employee simply can't be emailed a report until one is added. `carNumber` is searchable and displayed where employee details are shown. `team` must exactly match one of the fixed `TEAMS` values (`GET /employees/teams`) or the request is rejected with `400`. `employeeCode`, `employeeName`, `email`, and `carNumber` are all trimmed server-side before validation/storage (a pasted trailing space used to be able to defeat the duplicate check below — see `docs/decisions.md`).

`employeeCode` and `email` are checked for a case-insensitive duplicate on both create and update (`PUT /employees/:id`) and return `409` with a message naming the conflicting employee (for email) — closes a gap where the DB's own uniqueness constraint on `employeeCode` is case-sensitive while every search matches case-insensitively, and `email` had no DB uniqueness constraint at all. See `docs/decisions.md`.

`UpdateEmployeeDto`'s `team` follows the same `null`-means-clear / omitted-means-leave-alone convention as `email`/`carNumber` above (see the `PUT /employees/:id` row).

## Movements

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/movements` | `RECORD_ENTRY` \| `RECORD_EXIT` | See below |
| GET | `/movements?date=&employeeId=&movementType=` | `VIEW_DASHBOARD` | All filters optional |
| GET | `/movements/employee/:id?date=` | `VIEW_EMPLOYEE_HISTORY` | One employee's movements for one date |
| GET | `/movements/missing-summary?from=&to=` | `CORRECT_RECORDS` | Everyone missing an ENTRY or EXIT in the range (see below) |
| POST | `/movements/missing` | `CORRECT_RECORDS` | Adds a movement that was never recorded at all (see below) |

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
{ "created": false, "requiresConfirmation": true, "lastMovementType": "ENTRY", "lastMovementAt": "2026-09-22T03:33:00.000Z" }
```
`lastMovementAt` lets the client's confirmation prompt show *when* the last movement happened, not just its type — added in the 2026-09-22 UX audit.
The client must show a confirmation prompt and resubmit with `confirmed: true` to actually create the record. **The timestamp and recording user are always server-derived for a live tap — never send them in the body.** The one bounded exception is `clientMovementAt` on an offline-queue sync, above. `MovementRecord.recordedOffline` reflects whether that exception actually applied to a given record.

`MovementRecord.correctedByUserId` (and the `correctedBy`/`correctionReason` that go with it) is set only when a record came from `POST /movements/missing` instead of a real-time tap here — every list endpoint that includes `recordedBy` (`/movements`, `/movements/employee/:id`) now also includes `correctedBy`, so the frontend can flag it (see `AddedBadge`, 2026-10-26).

The "read last movement, then write" check above is wrapped in a Postgres advisory lock (`pg_advisory_xact_lock`) scoped to `employeeId`, so two requests for the *same* employee arriving at nearly the same instant (two guards on two different devices) are serialized rather than racing each other into two undetected duplicates — a different employee's request is never blocked by this. See [decisions.md](./decisions.md#offline-sync-preserve-the-real-tap-time-within-bounds).

### `GET /movements/missing-summary`

Returns every (date, employee) pair where that employee's ENTRY count and EXIT count (non-superseded) for that calendar day don't match, across the inclusive `from`/`to` range — the "who actually needs something added" list the Missing Movements page leads with. `from === to` for the page's plain single-date view; a full attendance cycle (`from`/`to` from `attendanceMonthRange()`) for its Attendance Month view — one endpoint, one evaluated-per-day rule, either way:
```json
[{ "date": "2026-10-05", "employeeId": 1, "employeeName": "Asha Rao", "employeeCode": "EMP001", "team": "Production", "status": "missingExit" }]
```
`status` is `missingExit` (entries > exits that day) or `missingEntry` (the reverse); someone with equal counts (including zero — no movement at all that day) isn't included for that day at all — evaluated independently per calendar day, so being balanced on one day never covers a gap on another in the same range. **Counts, not just presence** (fixed 2026-10-26): an entry/exit/entry day has both types recorded but still owes a final exit, which an earlier "does ENTRY exist and does EXIT exist" version of this check missed entirely. Deliberately scoped to `CORRECT_RECORDS`, not `VIEW_REPORTS` — Insights' `/insights/daily-duration` computes something similar but needs the broader, HR/Admin-only reports permission; this one exists specifically so Security (who holds `CORRECT_RECORDS` but not `VIEW_REPORTS`) can use this page without reaching into Insights. Matches `addMissingRecord`'s own rule exactly (not Insights' stricter day-completeness check, which also cares about movement ordering, not just counts).

### `POST /movements/missing`

Body (`AddMissingRecordDto`): `{ movementType, employeeId, movementAt (ISO string), correctionReason? }`. Adds a brand-new record for a movement the employee is genuinely missing that day. `correctionReason` is optional (made so 2026-10-26, by request) — still stored, and still what shows in the Audit Log and the Insights "corrected" drill-down, whenever one is given; omitted or blank just stores `null`, same as how both of those already render an absent reason.

**There is no endpoint to edit an existing record.** `POST /movements/:id/correct` and `MovementsService.correctMovement` were removed entirely 2026-10-23 — a record that already has a real recorded time can never be changed, by request. The server enforces this itself (not just the frontend): `addMissingRecord` rejects with a 400 when this `movementType`'s count for that employee/calendar day (app-timezone) has already caught up to (or passed) the other type's count — counts, not mere presence (fixed 2026-10-26, matching `missing-summary` above), with an explicit exception for a day with zero records of either type (still open to either type first). A stale client or a direct API call can't add a redundant/conflicting one either way. The check and the insert are wrapped in the same per-employee `pg_advisory_xact_lock` `POST /movements` uses, closing the same class of race (a guard's live tap landing between the check and the write). `isSuperseded`/`correctionOfId` remain on `MovementRecord` only for rows created before this change. See [decisions.md](./decisions.md#record-correction-append-only-not-soft-edit).

**`CORRECT_RECORDS`** (both endpoints above, plus `GET /employees/search-all`) is held by Security and Admin as of 2026-10-26 — not HR. Safe to extend to Security specifically because this page can never touch a record that already has a real value, only add one that's missing.


## Dashboard

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/dashboard/summary?date=` | `VIEW_DASHBOARD` | `{ totalEmployees, totalEntries, totalExits, currentlyInside }` for the given date (defaults to today, computed in IST via `todayInAppTimezone()` — not the UTC calendar date, which would be wrong for the first 5.5 hours of every IST day). `currentlyInside` counts employees whose last movement on that date was ENTRY — a live figure only for today; for a past date it reads as "not exited by end of that day." No working-hours math. |

## Reports & Email

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/reports/image?employeeId=&date=` | `DOWNLOAD_REPORT` | Streams a freshly generated PNG, not persisted. API-only — no download button in the current UI (removed by design decision, 2026-09-03) |
| GET | `/reports/pdf?employeeId=&date=` | `DOWNLOAD_REPORT` | Streams a freshly generated PDF, not persisted. API-only — same as above |
| POST | `/reports/email?employeeId=&date=` | `SEND_EMAIL` | The **only** endpoint that ever sends an email. Persists the PNG to storage, sends via the Microsoft Graph API (Adage's Microsoft 365 tenant, OAuth2), writes an `email_logs` row. Sends **from and CCs** the sending account's own login email (each security unit logs in with its own shared account, e.g. `securityunit1@adage-automation.com` — no separate setting for either) — falls back to the fixed `MAIL_FROM_ADDRESS` with no CC if the sending account has no email on file, or if Graph rejects that mailbox as the sender (2026-09-28). On any failure past that point (Puppeteer, Graph, storage, network), the `email_logs` row is still written with `status: FAILED` and the real cause in `errorMessage` (visible via `/reports/email-logs`) — but the `500` response returned to the caller is a generic "Failed to send email. Check Email Logs for details." rather than the raw error, so internals aren't leaked to the client (2026-10) |
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
| PUT | `/settings/:key` | `MANAGE_SETTINGS` — body `{ value: string }`. `:key` must be one of the known keys (`backend/src/common/constants/settings-keys.ts`: `COMPANY_NAME`, `TIMEZONE`, `EMAIL_SENDER_NAME`, `SHIFT_REFERENCE_START`, `SHIFT_REFERENCE_END`, `EXPECTED_DAILY_HOURS`) — any other key returns 400 |

## Insights

HR/Admin-only (`VIEW_REPORTS`, not held by Security) — aggregated, read-only analytics computed live from `movement_records`, never from a cache or a separate reporting table. Every endpoint below shares the same `fetchMovements`/`buildEmployeeDayAggs`/`filterByDayScope` pipeline in `InsightsService`, so a drill-down can never disagree with the chart that opened it, and `dayScope` means the same thing everywhere it appears.

**`dayScope`** (optional on every endpoint below except the raw-record drill-down metrics; default `weekdays` when omitted): `weekdays` | `all` | `weekends`. Controls which calendar days count toward every rate/average/trend — `weekdays` excludes Saturday/Sunday from every computed stat (the default, since the analytics assume a Mon-Fri work week), `all` includes every day, `weekends` includes only Saturday/Sunday (for auditing off-schedule presence). This **never** affects raw record listings (Corrections, Dashboard, per-employee movement history, or the `attendance`/`unit`/`hour`/`corrected` drill-down metrics below) — a real tap always shows there regardless of day, only the aggregated numbers are scoped. Added 2026-10-14.

| Method | Path | Notes |
|---|---|---|
| GET | `/insights/summary?from=&to=&team=&unitId=&movementType=&dayScope=` | All params optional — `from`/`to` (`YYYY-MM-DD`) default to the last 30 days ending today; `team` must match a value from `GET /employees/teams`; `unitId` filters to one `recordedByUserId`; `movementType` (`ENTRY`\|`EXIT`) only narrows the entry/exit tally charts (`attendanceTrend`, `uniqueEmployeesByDay`), never the duration-based ones (see note below) — including which *days* appear on their trend lines: `avgDurationTrend`/`hoursShortfall.trend`/`hoursLongDuration.trend`/`missingExits.trend` keep every day with a complete/missing-exit/missing-entry aggregate even if its only movement was the filtered-out type (e.g. filtering to ENTRY no longer drops a day whose sole movement was an overnight EXIT). Fixed 2026-10-21 — previously keyed those trends' date axis off the type-filtered tally, so such a day silently vanished from the chart while still counted in the KPI number above it. Backs every chart on the main Insights page. |
| GET | `/insights/earliest-movement` | No params. `{ date: string \| null }` — the earliest non-superseded movement's date, or `null` if no movements exist yet. Backs the "All Time" date preset, cached client-side after the first click. Added 2026-10-13. |
| GET | `/insights/drill-down?metric=&date=&from=&to=&team=&unitId=&hour=&movementType=&dayScope=` | Backs clicking a chart bar/point — returns the rows behind one chart element, capped at 500 rows. `metric` is one of `attendance`\|`unit`\|`hour`\|`corrected` (raw record listings — never scoped by `dayScope`, always show real taps) or `shortfall`\|`longDuration`\|`missingExit`\|`missingEntry`\|`team` (analytics metrics — honor `dayScope`). The first four scope to a single `date` when given one (a chart-bar click) or span the whole `from`/`to` range when not (a KPI-card click); `hour` needs `hour` (0-23); `unit` needs `unitId`; `team` needs `team` and returns every employee currently on that team, even one with zero movements in range, with `daysWithHoursTracked` per employee so the frontend can compute a shortfall rate. `attendance`/`hour`/`corrected` rows include `recordedByName`; `corrected` rows also include `correctedByName`. |
| GET | `/insights/employee-detail?employeeId=&from=&to=&dayScope=` | One employee's own trend over the range, picked via a search box rather than a chart click. See response shape below. |
| GET | `/insights/daily-duration?date=&team=&unitId=&dayScope=` | One specific day (not a range) — every employee with a movement that day (`rows`, always real taps regardless of `dayScope`) plus the active-roster complement with zero taps that day (`noMovement` — only populated when `date` matches the selected `dayScope`, e.g. a Saturday's `noMovement` is empty under the default `weekdays` scope, since nobody's expected in). Backs the "View Daily Roster" modal. Added 2026-10 (Spec item #5). |
| GET | `/insights/export/team-breakdown?from=&to=&team=&unitId=&movementType=&dayScope=` | `.xlsx` of `teamBreakdown`, same params as `/insights/summary`. |
| GET | `/insights/export/drill-down?metric=&...` | `.xlsx` of one drill-down's full (unfiltered, uncapped) row set — same params as `/insights/drill-down`. |
| GET | `/insights/export/daily-duration?date=&...` | `.xlsx` of one day's "Tapped In" list — same params as `/insights/daily-duration`; `noMovement` rows aren't included in the export. |

`/insights/summary` response shape:
```
{
  range: { from, to },
  shiftReference: { start, end, expectedHours },   // reference window only — never a "late" cutoff, see decisions.md
  attendanceTrend: [{ date, entries, exits }],
  uniqueEmployeesByDay: [{ date, count }],         // distinct employees with a tap that day — shown as "Employees Present"
  totalRosterSize: number,                         // ACTIVE employees only — denominator for Daily Attendance Rate's %
  avgDurationTrend: [{ date, avgHours }],
  hoursShortfall: { shortfallDays, totalEmployeeDays, trend: [{ date, shortfallCount }] },
  hoursLongDuration: { longDurationDays, totalEmployeeDays, threshold, trend: [{ date, longDurationCount }] },
  missingExits: { count, trend: [{ date, count, missingEntryCount }] },
  hourlyDistribution: [{ hour, entries, exits }],
  unitActivity: [{ unitId, unitName, entries, exits }],   // sorted alphabetically by unitName, not insertion order
  teamBreakdown: [{ team, entries, exits, employeeCount, employeeDays, daysWithHoursTracked, avgHours, medianHours, shortfallDays, longDurationDays }],
}
```

`/insights/employee-detail` response shape:
```
{
  employee: { id, employeeName, employeeCode, team, isActive },
  range: { from, to },
  avgArrival: string | null,   // "HH:mm", averaged in minutes-of-day (Asia/Kolkata)
  avgDeparture: string | null,
  dailyHours: [{ date, hours: number | null, missingExit: boolean }],
  dailyCounts: [{ date, entries, exits }],
  employeeAvgHours: number | null,              // this employee's own average, same complete-days-only rule as teamBreakdown.avgHours (1-decimal display rounding)
  employeeDurationBucket: number | null,        // this employee's own durationDistribution bucket — computed with the exact same rounding as the histogram, not re-derived from employeeAvgHours
  durationDistribution: [{ hours, count, employees: { name, hours }[] }],  // every ACTIVE employee's own avg duration, bucketed to the nearest quarter hour, company-wide — backs "How This Employee Compares"; `employees` is who's in that bucket (with each person's own exact 1-decimal duration), shown on click-through
}
```

`hoursShortfall` counts an employee-day where `(last exit − first entry) < expectedHours` — this is the only real compliance signal, since the office uses flexible timing (no fixed clock-in deadline). `shiftReference` is shown on charts purely as a reference band.

**"Employee-day" terminology** (`teamBreakdown[].employeeDays`/`.daysWithHoursTracked`, and `hoursShortfall.totalEmployeeDays`/`hoursLongDuration.totalEmployeeDays`): one employee, one calendar day — 3 people present on Monday = 3 employee-days, same as 1 person present on 3 different days. The frontend uses plain-language labels rather than "employee-days" anywhere in the UI: `teamBreakdown[].employeeDays` is shown as **"Days Present"** (any day with at least one tap, even a missing exit — a team-wide total, not a headcount); `teamBreakdown[].daysWithHoursTracked` and `hoursShortfall`/`hoursLongDuration`'s `totalEmployeeDays` are the **"Days With Hours Tracked"** concept (only days with both an entry and an exit, so a real duration exists). See `docs/decisions.md`.

**`teamBreakdown[].avgHours`/`.medianHours` and `.shortfallDays`/`.longDurationDays` (and their rates) are computed against `daysWithHoursTracked`, not `employeeDays`** — a missing-exit day has no measurable duration, so including it in the denominator would dilute both numbers. Fixed 2026-10-13 (previously used `employeeDays`, understating both for any team with missing exits). `medianHours` and `longDurationDays` back the Department Comparison charts (added 2026-10-13) — see `docs/decisions.md`.

**`totalRosterSize` is active employees only** (unlike `teamBreakdown[].employeeCount`, which deliberately includes inactive employees for team-size comparison) — it feeds Daily Attendance Rate's %, whose own drill-through (the "No Movement Recorded" list) also excludes inactive employees, so the two must agree. Fixed 2026-10-13 (previously included inactive employees, so the % could never reach 100% and disagreed with its own drill-through's row count).

**`peakHours` and `emailStats` were removed** (2026-10-06) — see `docs/decisions.md`'s "Removed Peak Entry/Exit Hours and Email Reports Sent" entry.

## Audit Logs

| Method | Path | Permission |
|---|---|---|
| GET | `/audit-logs?entityType=&entityId=&userId=&from=&to=&q=&skip=&take=` | `MANAGE_SETTINGS` | `skip`/`take` for pagination (default `take=50`); response rows include the acting user's `{id, name}`. `from`/`to` (`YYYY-MM-DD`, both optional) scope to a date range using the same local-day boundaries as every other date-scoped query (`to` is inclusive of that whole day). `q` does a case-insensitive substring search across `action`, `entityType`, `ipAddress`, and the performing user's name. Always ordered newest-first. |

## Error shape

Non-2xx responses return `{ statusCode, message, error }` (Nest's default). The frontend's `api/client.ts` throws `ApiError` with `.status` and `.message` extracted from this. `401` → not authenticated (redirect to login). `403` → authenticated but missing permission. `429` → rate-limited (login, forgot-password, and reset-password). `400` → validation failure, including a malformed numeric route/query param (e.g. `GET /employees/abc`) — every `:id` and numeric query param is parsed with `ParseIntPipe` or the `parseOptionalInt` helper, never a raw `Number()` that could reach Prisma and surface as a 500.

A client-side request that takes longer than 20s aborts and throws `ApiTimeoutError` (not an `ApiError`) — see `frontend/src/api/client.ts`.
