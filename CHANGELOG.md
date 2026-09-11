# Changelog

## 2026-09-11 (cont.) — Timezone validation, audit-log PII sanitization, offline-conflict polish, expanded test coverage, docs sync

### Added

- **Backend timezone validation** (`backend/src/common/utils/timezone.ts`) — checks at boot whether the runtime `TZ` matches `APP_TIMEZONE`; in production, a mismatch now fails loudly at startup instead of silently drifting day boundaries. Closes part of the "Known simplifications: timezone correctness" roadmap item (the remaining piece — explicit UTC↔IST conversion independent of the process TZ — is still open).
- **Audit log PII sanitization** (`backend/src/audit-logs/audit-log.service.ts`) — `oldValue`/`newValue` snapshots are now sanitized before storage: sensitive keys (passwords, tokens, secrets, session/cookie fields) are stripped, and full employee objects are compacted to a minimal summary (id/name/code/car number/active) instead of every column. Closes the "audit log rows duplicating full employee PII" item tracked since the 2026-09-04 audit.
- **Offline conflict resolution got a "Dismiss" option** alongside the existing "Record anyway" — a guard can now discard a stale conflict without being forced to record it, plus each conflict shows its reason. `frontend/src/pages/SecurityHome.tsx`, `frontend/src/offline/movementQueue.ts`.
- **Expanded backend/frontend test coverage** — new spec files for `employees.controller`, `reports.controller`, `reports.service`, `audit-log.service`, `timezone`, and the frontend's `movementQueue`/`EmployeeDetails`.
- Accessibility polish: `role="status"`/`role="alert"` + `aria-live` on every status banner across SecurityHome/EmployeeDetails/Settings.
- `backend/data/employees.csv` gained a `car_number` column (blank for existing rows); the old dated-snapshot CSV (`employees-roster-2026-09-09.csv`) was removed as fully redundant with it.

### Docs

Synced `docs/api-reference.md`, `docs/architecture.md`, `docs/branding-and-data-needed.md`, `docs/database-schema.md`, `docs/deployment.md`, `docs/developer-guide.md`, `docs/email-provider-options.md`, `docs/roadmap.md`, `docs/security.md`, `docs/testing.md`, `docs/user-guide-admin.md`, `docs/user-guide-hr.md`, `docs/user-guide-security.md`, and `README.md` against the current code — most notably, `docs/roadmap.md`/`docs/testing.md` no longer say "zero test files exist" now that real backend/frontend test coverage does.

## 2026-09-11 — Fixed HR's Dashboard access, broken by the recording-permission removal

### Fixed

- **HR's Dashboard employee filter silently returned nothing**: `GET /employees/search` was gated behind `RECORD_ENTRY`, which HR lost in Commit 15. Changed to `VIEW_DASHBOARD` — held by every role that needs this endpoint (SECURITY for the recording screen, HR for the Dashboard filter), with no extra access granted (`backend/src/employees/employees.controller.ts`).
- **`AdminNav.tsx`'s "Record Movement" link had no permission check at all**, unlike every other link in that component — it kept showing for HR even after HR lost `RECORD_ENTRY`, dangling a link to a page that would just redirect away. Wrapped it in `hasPermission('RECORD_ENTRY')` to match the established pattern.
- Verified live: HR now lands on `/dashboard` after login with only Dashboard/Employees in the nav, the employee filter dropdown returns real results, and Security's recording flow is unaffected.
- **CI pipeline (`.github/workflows/ci.yml`) would have failed on every run**: `npm ci`'s `postinstall` hook runs `prisma generate`, which requires `DATABASE_URL` to resolve — with no `.env` on a fresh CI checkout and no env var set, it fails with "Environment variable not found" before lint/test/build ever run. Added `DATABASE_URL`/`SESSION_SECRET` to the workflow's `env:` block (dummy values — nothing in this workflow connects to a real database). Found by an audit fork; fixed directly.

## 2026-09-10 (cont. 4) — Total working hours, offline conflict surfacing, auth cache, edit-in-place for employees, accessibility improvements, stale-code/docs sweep

### Added

- **Total working hours on the employee day view** (`frontend/src/pages/EmployeeDetails.tsx`) — a teal banner showing "Total working hours: Xh Ym" now appears below the movement list. Calculated client-side from the already-loaded records: first ENTRY to last EXIT of the day. No backend change, no new endpoint. Returns `null` (banner hidden) when there is no EXIT yet. Formatted as `"8h"`, `"30m"`, or `"7h 45m"`. `IconClock` (already in icons.tsx) used for the icon. `.working-hours-banner` CSS added to `global.css` using the existing brand teal palette.

- **Offline conflict surfacing** (`frontend/src/pages/SecurityHome.tsx`, `frontend/src/offline/movementQueue.ts`) — a queued movement that comes back `requiresConfirmation` during sync is now flagged `syncState: 'conflict'` and surfaced to the guard as a red "X offline movements need review" banner with a "Record anyway" button, instead of being silently auto-confirmed. The queue is also scoped per `userId` so guards sharing a device don't see each other's pending movements.

- **Offline auth cache** (`frontend/src/auth/AuthContext.tsx`) — the last successfully authenticated user is cached in `localStorage` (12h expiry, key `adage.last-authenticated-user`). If `/auth/me` fails because the browser is offline (no `ApiError`), the cached user is restored so the recording screen and queue remain accessible. Cleared explicitly on logout.

- **Edit-in-place for employees** (`frontend/src/pages/Employees.tsx`) — an "Edit" button per row expands an inline form to update name, email, and car number without navigating away. Previously the edit UI was undocumented / non-functional from the admin screen.

- **`SESSION_SECRET` production guard** (`backend/src/main.ts`) — throws at boot if `SESSION_SECRET` is unset in production, preventing a silent deploy with an empty/default session secret.

- **`clientRequestId` conflict check** (`backend/src/movements/movements.service.ts`) — if a `clientRequestId` arrives that already exists but maps to a *different* employee, movement type, or recorder, the server throws `ConflictException` instead of silently returning the wrong record. Closes a theoretical idempotency-key collision scenario.

- **`AuthContext` refactored into three files** — `AuthContext.tsx` (provider + cache logic), `auth-context.ts` (context object + type, no React imports beyond `createContext`), `useAuth.ts` (`useAuth` hook). All component imports updated to use `useAuth.ts`. Eliminates the re-export of `ApiError` from `AuthContext.tsx` — callers now import it directly from `api/client.ts`.

- **`ErrorBoundary` wrapped around entire app** (`frontend/src/App.tsx`) — previously `ErrorBoundary` existed but was never mounted at the root level.

- **`eslint-disable` comment removed** (`frontend/src/components/ErrorBoundary.tsx`) — the `no-console` disable in `componentDidCatch` was unnecessary since `console.error` is appropriate for error boundary logging.

- **Modal accessibility** (`SecurityHome.tsx`, `Corrections.tsx`) — both confirm/correction dialogs now have `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, initial focus on open, Tab focus-trap, and Escape-to-close.

- **`aria-label` added** to employee search inputs on SecurityHome, Dashboard, and Corrections for screen-reader clarity.

- **`npm run test`** wired at the root workspace level to run backend and frontend tests together (`--runInBand`). `npm run load:test` added for the `autocannon` benchmark. Root-level test tooling deps (`supertest`, `@typescript-eslint/*`, `eslint*`, `fake-indexeddb`, `autocannon`) added. Frontend `package.json` gains a `test` script.

### Changed

- **Login label** (`frontend/src/pages/Login.tsx`) — field label changed from "Username or Email" to "Username" to match what the backend actually accepts (username only, not email).

- **Users.tsx** imports `useAuth` from `auth/useAuth` (not `auth/AuthContext`) — consistent with the refactor above.

- **`UnauthorizedException` import removed** from `backend/src/auth/auth.service.ts` — it was imported but unused; the local strategy throws it directly.

### Docs

- `docs/architecture.md` — updated `auth/` file listing for the three-file split; updated `movementQueue.ts` description for userId scoping and conflict state.
- `docs/decisions.md` — updated "Offline handling" ADR to reflect conflict-surface behavior; added new "Offline auth cache" ADR.
- `docs/roadmap.md` — working hours added to Done; audit findings section updated (offline auth, modal a11y, offline duplicate resolution all now done); "Known simplifications" conflict description updated.
- `docs/testing.md` — intro updated; added test items for conflict state and idempotency-key collision.
- `docs/user-guide-security.md` — offline conflict section updated to describe the "Record anyway" banner.
- `README.md`, `docs/user-guide-hr.md`, `docs/user-guide-admin.md`, `docs/developer-guide.md` — working-hours scope updated (from "none" to "day-view total; no timesheet roll-up").
- `backend/src/dashboard/dashboard.controller.ts` — stale "no working-hours anywhere" comment updated.

## 2026-09-10 (cont. 3) — Forgot password, full crash/bug audit fixes, a deployment-blocking migration bug fixed

### Added

- **Self-service "forgot password"** — `POST /auth/forgot-password` and `POST /auth/reset-password` (`backend/src/auth/`), a single-use SHA-256-hashed 1-hour-expiring token stored on the `User` row (new migration `20260910100000_add_password_reset_token`). New frontend pages `ForgotPassword.tsx`/`ResetPassword.tsx`; the login page's dead placeholder link now works. Both endpoints rate-limited like login. Verified live end to end: invalid/expired/reused token → 400, valid token + short password → 400, valid token + valid password → 200 and the new password logs in, non-existent email → identical generic response to a real one (no enumeration leak). See `docs/decisions.md`.

### Fixed — full codebase crash/bug audit (forked, then verified/fixed directly)

- **Frontend white-screen crash**: `EmployeeDetails.tsx` computed `dateLabel` from an unvalidated `date` URL param — a malformed/hand-edited/stale-bookmarked link threw a `RangeError` synchronously during render, and no `ErrorBoundary` existed anywhere in the app, so this crashed the entire React tree to a blank screen. Fixed at the source (falls back to today for an invalid date) and added `frontend/src/components/ErrorBoundary.tsx` as defense in depth. Verified live via Puppeteer: navigating to `/employee-details?...&date=not-a-real-date` now renders normally.
- **Backend 500s instead of clean 400s** on every date-filtered endpoint (`GET /movements`, `GET /movements/employee/:id`, `GET /dashboard/summary`, `GET /reports/image`/`pdf`, `POST /reports/email`) — same root cause, an unvalidated `date` query param reaching Prisma/`Intl.DateTimeFormat` as an `Invalid Date`. Extracted the duplicated `dayRange()` logic (previously copy-pasted in both `movements.service.ts` and `reports.service.ts`) into one shared, validated helper (`backend/src/common/utils/day-range.ts`) that throws a clean `BadRequestException` instead. Verified live: `?date=not-a-date` and `?date=2026-13-99` both now return 400, valid dates unaffected.
- **Pooled Puppeteer browser had no self-healing**: if it crashed/disconnected mid-session (rather than failing at launch, which was already handled), every subsequent report request kept returning the same dead `Browser` and failing forever until the whole Node process restarted — a regression risk introduced by the 2026-09-10 pooling change itself. Added a `disconnected` listener that clears the cached browser so the next call relaunches.
- **Corrections.tsx**: clearing the date filter sent `""` to `new Date("")`, throwing a raw `"Invalid time value"` RangeError shown verbatim to the user instead of a friendly message. Now validated before submit.
- Two unguarded non-null assertions in `report-generator.service.ts` (`bodyHandle!.boundingBox()!`) replaced with an explicit check and a clean `InternalServerErrorException`.

### Fixed — a real deployment-blocking bug, found while adding the password-reset migration

- Migration `20260909120000_enable_row_level_security` unconditionally ran `ALTER TABLE "session" ENABLE ROW LEVEL SECURITY`, but that table only exists once the app has booted at least once (created at runtime by `connect-pg-simple`). On any genuinely fresh database — a real first production deploy, a CI/shadow database — this would fail and abort every migration after it, forever, blocking the app from ever starting. Found via `prisma migrate dev`'s shadow-database validation. Fixed by editing the already-applied migration (a rare, deliberately-justified exception — see `docs/decisions.md` — since nothing has been deployed yet and this dev database is the only environment that has ever run it) to guard the statement behind an existence check. Verified: `prisma migrate deploy` runs clean against the live dev database with no drift/checksum error.

### Docs

- Updated `docs/roadmap.md`, `docs/decisions.md` (two new ADRs), `docs/security.md`, `docs/api-reference.md`, `docs/architecture.md`, `docs/database-schema.md` (also added two previously-undocumented audit actions, `REPORT_DOWNLOADED` and `PASSWORD_RESET_REQUESTED`), and `docs/testing.md` to reflect all of the above.

## 2026-09-10 (cont. 2) — Full "Email Details" flow verified working end to end

### Verified live

- **The Microsoft Graph API OAuth2 email send is confirmed working**: Adage registered the Azure AD app, filled in `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` in `backend/.env`, and granted admin consent for `Mail.Send`. A live isolated test first caught the exact expected failure mode (`403 ErrorAccessDenied` — token acquisition succeeded, confirming the credentials, but the send was rejected pre-consent); after consent was granted, the same test succeeded.
- **Supabase Storage is confirmed working**: `STORAGE_*` env vars filled in. A full, real `POST /reports/email` call against employee `Adarsh Bhaskaran Chanabhat` returned `email_logs.status: "SENT"` with `reportFileUrl` populated; the signed re-download URL (`GET /reports/email-logs/:id/download`) was fetched directly and confirmed to be a valid 720×530 PNG.
- This closes both items that were previously tracked as "Blocked — waiting on external input" in `docs/roadmap.md`.

### Changed — temporary configuration, noted for follow-up

- **No `security@adage-automation.com` mailbox exists yet** — `MAIL_FROM_ADDRESS`/`SECURITY_EMAIL` in `backend/.env` are temporarily set to `shivani.naik@adage-automation.com` as a stand-in for both the sending mailbox and the CC address. Swap back once the real mailbox is created (see `docs/email-m365-admin-handoff.md`). Recorded in project memory (`project_email_temp_mailbox.md`) so this isn't forgotten in a future session.
- **The Exchange Online application access policy restricting the Azure app to one mailbox has not been confirmed run** — `Mail.Send` as an application permission can currently send as any mailbox in the tenant. Tracked as a follow-up security-hardening step in `docs/roadmap.md` and `docs/security.md`, not a blocker to normal use.
- Cleaned up the one fabricated test movement record created to exercise this flow (`clientRequestId: test-e2e-email-verify-1`). Deliberately **left the resulting `email_logs` row in place** — unlike the movement record, it reflects a real event (a real email was actually sent and delivered), and `email_logs` exists specifically to prove what was sent, so removing it would defeat that purpose (same principle as never touching `audit_logs`).

### Docs

- Brought `docs/roadmap.md`'s "Blocked" section, "Done" list, and "Suggested next step" current with the above. Removed a stale duplicate `docs/decisions.md` reference (`docs/decisions.md#numeric-input-validation...`) gap — added the missing ADR for the `ParseIntPipe({ optional: true })` bug found and fixed 2026-09-10. Added the settings-key-whitelist and numeric-param-validation behavior to `docs/api-reference.md` and `docs/security.md`. Enhanced `README.md`'s Technology Stack table with previously-undocumented pieces (RLS, pooled Puppeteer, npm workspaces, request timeout, RBAC approach). Fixed remaining `cd backend`-style command inconsistencies in `docs/testing.md`, `docs/database-schema.md`, and `docs/branding-and-data-needed.md` to match the npm-workspaces command style used everywhere else.

## 2026-09-10 (cont.) — Fixed loading-vs-empty-state flash on Dashboard/EmployeeDetails/Corrections

### Fixed

- **Dashboard, EmployeeDetails, and Corrections all initialized their record list as `[]`**, which is indistinguishable from "genuinely no records for this date" — so the "No records found" empty state briefly flashed on every navigation or filter change, even when data was about to arrive. Added a `recordsLoading` flag to each page, set before the fetch and cleared in `.finally()`, and gated the empty-state block on `!recordsLoading`. Verified live via a scripted check: switching Dashboard's date to one with real movement data showed zero empty-state flash before the table rendered (a naive fetch-in-progress check would have shown it).

## 2026-09-10 — Email switched to Microsoft Graph API (OAuth2); several roadmap items closed out

### Changed — email transport

- **Switched email sending from SMTP to the Microsoft Graph API** (`backend/src/email/email.service.ts`) — Adage's Microsoft 365 admin confirmed the tenant has basic-auth SMTP AUTH retired, so the SMTP implementation from 2026-09-07 could never have worked regardless of credentials. Now authenticates via an Azure AD app registration (OAuth2 client-credentials grant against `login.microsoftonline.com`) and sends through `graph.microsoft.com/v1.0/users/{mailbox}/sendMail`. Removed `nodemailer`/`@types/nodemailer` (now unused). Rewrote `docs/email-m365-admin-handoff.md` for the new Azure app-registration steps (register app, grant `Mail.Send` with admin consent, scope it to the security mailbox via an Exchange Online application access policy) and updated every doc that referenced SMTP env vars (`README.md`, `docs/architecture.md`, `docs/api-reference.md`, `docs/deployment.md`, `docs/developer-guide.md`, `docs/roadmap.md`, `docs/branding-and-data-needed.md`, `docs/email-provider-options.md`) plus a new ADR in `docs/decisions.md`. New env vars: `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/`MAIL_FROM_ADDRESS` (replacing `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`EMAIL_FROM`). Still blocked on the admin handoff — no functional regression, since a real send was never possible either way.

### Fixed — closing out several tracked roadmap items

- **`SettingsController` now whitelists known setting keys** (`backend/src/common/constants/settings-keys.ts`) — `PUT /settings/:key` with an unrecognized key now returns a clean 400 instead of silently creating a junk row.
- **Every controller now uses `ParseIntPipe` (or a small `parseOptionalInt` helper) for numeric route/query params** instead of raw `Number(id)` — a malformed ID now returns a clean 400 instead of reaching Prisma and surfacing as a raw 500. Caught and fixed a real bug introduced mid-change: Nest's built-in `ParseIntPipe({ optional: true })` was found to throw even when the query param is completely absent (verified against the installed `@nestjs/common` 10.4.22), not just when malformed — switched optional numeric query params to a small `parseOptionalInt()` helper (`backend/src/common/utils/parse-optional-int.ts`) instead, verified live against every affected endpoint (employees list/search, movements list, audit logs, email logs) with both present and absent params.
- **Puppeteer now reuses one pooled browser instance** (`backend/src/reports/report-generator.service.ts`) instead of launching a fresh headless Chromium per report — only a page is opened/closed per request now. Verified live: three consecutive report generations showed decreasing latency (2316ms → 1786ms → 1565ms), consistent with the launch cost being paid once.
- **Added a request timeout to the frontend API client** (`frontend/src/api/client.ts`) — every fetch now aborts after 20s via `AbortController` instead of a hung request leaving a "Sending…"/"Saving…" button stuck forever with no way out but reloading.

## 2026-09-09 (cont. 6) — Removed unused dependencies, deprecated tsconfig option

### Removed

- **`@nestjs/schedule`** (backend dependency) — never wired in anywhere: no `ScheduleModule` import, no `@Cron`/`@Interval`/`@Timeout` decorator anywhere in the codebase. Confirmed unused, removed.
- **`date-fns-tz`** (backend dependency) — the only place its name appeared was in a code comment describing it as a future option, never an actual import. Confirmed unused, removed. Updated the comment in `movements.service.ts`'s `dayRange()` and the matching note in `docs/roadmap.md` accordingly.
- **`baseUrl` in `backend/tsconfig.json`** — flagged by the editor as deprecated (removed in TypeScript 7.0). Nothing in the codebase uses path aliasing (no `paths` map exists), so it was dead configuration; removed rather than suppressed.

### Verified

- `npm install` from the repo root cleanly removed 7 transitive packages with the two dependencies gone.
- Full `npm run build` (backend + frontend) still succeeds with zero errors after all three removals.

## 2026-09-09 (cont. 5) — Stale-data sweep across code and docs; docs fully synced to current state

Checked the whole repo (code comments + all of `docs/` + root `README.md`) for stale references left behind by recent changes (npm workspaces conversion, CSV consolidation, the `clientRequestId`/RLS additions, the Employees pagination fix). Found and fixed real staleness, not just cosmetic:

### Fixed — real bugs in comments/docs, not just prose

- **`backend/scripts/import-employees.ts`'s usage comment pointed at a deleted file** (`data/employees-import.csv`, removed in the CSV-consolidation pass) — following it verbatim would fail. Corrected to `data/employees.csv`.
- **`docs/deployment.md`'s "Build & run" steps were broken by the npm-workspaces conversion** — `cd backend && npm ci` / `cd frontend && npm ci` can no longer work, since `backend/package-lock.json` and `frontend/package-lock.json` were deleted in favor of one root lockfile. Rewritten to install/build from the repo root, with `-w backend` for the workspace-specific deploy step.
- **`README.md`'s "Build" section still described two separate per-app build commands**, contradicting its own "Local Development" section above it (which correctly describes the single-root-command flow). Rewritten to match.
- **`docs/api-reference.md` had three real inaccuracies**, not just missing-new-feature gaps: `GET /employees/:id`'s documented permission (`MANAGE_EMPLOYEES`) doesn't match the code (`VIEW_EMPLOYEE_HISTORY`, changed in an earlier audit); `CreateEmployeeDto`'s `email` was documented as required when it's been optional since the email-optional rollout; `POST /movements`'s body was missing the `clientRequestId` field entirely. All three fixed, plus documented the new `GET /employees` search/pagination shape (`q` param, `{ rows, total }` response).

### Updated — docs that were accurate but had fallen behind recent work

- `docs/roadmap.md` — was still headed "Status as of 2026-09-04"; added everything shipped since (idempotency key, RLS, npm workspaces, full 205-employee roster + email-optional, the 2026-09-09 workflow audit's two fixes), updated the stale "6 employees imported" and "hypothetical large employee count" lines.
- `docs/decisions.md` — added three missing ADR entries for decisions already live in the code but never written down: movement idempotency key, Row Level Security (defense in depth), npm workspaces.
- `docs/architecture.md` — frontend page list was missing `Corrections.tsx` and `AuditLog.tsx` entirely; added those plus the idempotency-key and RLS bullets to "Key design decisions."
- `docs/security.md` — added the RLS bullet under Data protection.
- `docs/user-guide-admin.md` / `docs/user-guide-hr.md` — updated the Employees-screen instructions to reflect email now being optional and the new search/pagination UI (previously undocumented since it didn't exist until this session's earlier fix).

## 2026-09-09 (cont. 4) — Full workflow audit: leftover test data purged, Employees pagination gap fixed

Ran a complete pass over every user-facing workflow (Auth, Security movement recording, Dashboard, Employees, Users, Corrections, Audit Log, Settings, Reports/Email) across all three roles, both at the API level (25-check script) and via a full Puppeteer UI walkthrough of every screen. Two real issues found and fixed live; everything else passed.

### Fixed

- **`movement_records` and `email_logs` held leftover test data from earlier sessions' verification work** — all 4 movement records (dated 2026-09-03/09-04, one with the literal `correctionReason: "test"`) and both `email_logs` rows (FAILED, test sends) were artifacts, not real activity. Deleted via `deleteMany({})`. `audit_logs` was deliberately left untouched — it's a permanent record and none of its entries were fabricated data, just a true log of the test actions that were taken.
- **Employees admin screen (`/employees`) had no pagination or search** — `findAll()` returned a flat, silently-capped 50 results with no way to reach the rest. With the roster now at 205 real employees, 155 were completely unreachable through this screen (spec §53's "large employee databases" case). Fixed:
  - `backend/src/employees/employees.service.ts` — `findAll()` now takes `{ skip, take, q }`, searches name/code/email, and returns `{ rows, total }` via a parallel count query.
  - `backend/src/employees/employees.controller.ts` — passes the new `q` query param through.
  - `frontend/src/pages/Employees.tsx` — rewritten with a debounced search box, "Load More" pagination (same pattern as `AuditLog.tsx`), and an empty state.
  - Verified live: `GET /employees` → 50 of 205 with an accurate total; `GET /employees?q=Naik` → all 12 matches (uncapped, unlike the guard-facing 10-result autocomplete); confirmed visually in the browser for both the paginated list and the search.

### Verified, no changes needed

- Auth (login/logout/session, rate limiting), Security's search-and-record flow, Dashboard filters, Users/Corrections/Audit Log/Settings admin screens, RBAC 403s for Security/HR on admin-only routes, report PNG download, email-logs listing. Zero console/page errors across the full UI walkthrough.

### Tracked as "asks" (blocked on external input, not fixable from here)

- SMTP credentials for `security@adage-automation.com` (Microsoft 365 admin) — `docs/email-m365-admin-handoff.md`.
- Supabase Storage bucket + S3-compatible keys for persisting emailed reports.
- 54 employees still missing an email address in `backend/data/employees.csv`.

All three already tracked in `docs/roadmap.md`'s "Blocked — waiting on external input" section; restated here as the outcome of this audit.

## 2026-09-09 (cont. 3) — Data file consolidation, casing regression fix, directory cleanup

### Fixed

- **Real data-quality regression found while checking a doc question**: importing the full 205-person roster (`backend/data/employees-roster-2026-09-09.csv`) had silently overwritten the 6 originally-imported employees' nicely title-cased names with the source data's ALL-CAPS formatting (e.g. "Shivani R Naik" → "SHIVANI R NAIK") — and left all 199 other employees in ALL CAPS too, since the import script never normalized casing. Every screen in the app displays `employeeName` directly (Security search, Dashboard, reports, emails), so this was a real, visible regression. Fixed `backend/scripts/import-employees.ts` to title-case names on import going forward, then re-ran the import to fix all 205 existing records. Verified live: zero employees remain in ALL CAPS.

### Changed — data file consolidation

- **`backend/data/employees-import.csv` (the original 6-employee batch) deleted** — confirmed first that all 6 of its employees, with matching emails, already existed in the larger roster file (just checked, didn't assume), so it was fully redundant.
- **`backend/data/employees-roster-2026-09-09.csv` renamed to `backend/data/employees.csv`** — one stable, living filename for the current roster instead of a dated snapshot name, so future updates overwrite this one file in place rather than accumulating a new dated CSV (and the same redundancy) every time.
- **Removed the duplicate `Adage_Logo.png` at the repo root** — this was the original file as first shared, since copied into the two places the app actually uses it (`frontend/public/logo.png` for the browser, `backend/src/reports/assets/adage-logo.png` embedded into generated reports). Those two *are* necessarily separate — they ship inside two independently-built/deployed apps — but the root copy served no purpose once both were in place and was just a stale-copy risk.
- Checked the full repo tree for other redundancy (temp/debug files, doc overlap) — found none beyond the above; the doc consolidation pass from earlier today already covered the docs folder.
- Updated `docs/branding-and-data-needed.md`'s employee-data section to reflect reality (205 imported, not "still needed"; the real remaining gap is 54 employees' missing email addresses, not the roster itself).

## 2026-09-09 (cont. 2) — Converted to npm workspaces for true single-command portability

### Changed

- **Root `package.json` converted to npm workspaces** (`"workspaces": ["backend", "frontend"]`), replacing the earlier `--prefix`-based approach. On any machine, `npm install` once at the repo root installs backend + frontend + root dependencies together (npm hoists shared packages into one root `node_modules`) — no separate `cd backend && npm install` / `cd frontend && npm install` steps needed anymore.
- **`backend/package.json` gained a `postinstall: "prisma generate"` hook** — the Prisma client is now generated automatically as part of that single `npm install`, rather than requiring a manual `npx prisma generate` afterward.
- Added root scripts: `build` (backend then frontend), `seed`, `prisma:migrate` — so common tasks also don't require `cd`-ing into a workspace.
- Removed `backend/package-lock.json` and `frontend/package-lock.json` in favor of one root `package-lock.json` (npm workspaces requires a single lockfile).
- Updated `README.md` and `docs/developer-guide.md`'s setup/day-to-day/build instructions to the new one-command flow. Deployment-specific instructions (`docs/deployment.md`) intentionally left as separate backend/frontend steps, since production deploys them to different hosts.

### Verified

- Full clean-slate test: deleted all `node_modules` (root, backend, frontend) and all lockfiles, ran `npm install` once from the root, confirmed the Prisma client was generated automatically with no manual step, confirmed `npm run build` (root) built both apps with a complete `backend/dist` (including the logo asset at the correct path) and a complete `frontend/dist`, and confirmed `npm run dev` (root) brought up both the backend (`:4000`, `/api/auth/me` → 401 as expected) and frontend (`:5173`) together from a single command. This is the same flow anyone cloning the repo fresh on a different machine would run.

## 2026-09-09 (cont.) — Combined dev script, closed out email-optional rollout

### Added

- **Root `package.json` with `npm run dev`** — runs backend and frontend together from one command (`concurrently`), instead of two separate terminals. `npm run dev:backend`/`npm run dev:frontend` remain available individually. Verified live: both `http://localhost:5173` and `http://localhost:4000/api` come up from the single command.

### Completed (picked up in-progress work)

- Verified the employee-email-optional change (schema `Employee.email` now `String?`, migration `20260909123000_allow_employee_email_null`, backend DTOs, frontend `types.ts`) was already fully applied to the live database — not just partially done.
- Verified the ~205-employee real roster (`backend/data/employees-roster-2026-09-09.csv`) was already successfully imported (54 of them intentionally with no email yet) via `backend/scripts/import-employees.ts`, which now accepts a blank email per row.
- **Found and fixed a real gap this left behind**: the "Add Employee" form and "EMAIL DETAILS" button hadn't been updated to match — the form still marked email `required` (and would have sent `""` rather than omitting the field, which `@IsEmail()` rejects even though `@IsOptional()` is set), and "EMAIL DETAILS" had no check for a missing email before rendering, meaning clicking it for any of the 54 no-email employees would round-trip to the server just to get a 400. Fixed: email field is now optional in the form (blank omitted from the payload rather than sent empty), the employee table shows "—" for a missing email, and "EMAIL DETAILS" only renders when an email is actually on file, with a clear inline note when it isn't ("No email on file for X — add one via Employees before details can be sent.").
- Confirmed the earlier RLS migration, idempotency-key migration, and this session's clean backend rebuild are all still intact and the database is fully in sync (`prisma migrate status` → up to date, 4 migrations applied).

## 2026-09-09 — Second audit pass, idempotency fix, RLS hardening, docs consolidation

### Fixed (from a second audit pass — new SMTP/storage code + fresh spec-completeness check)

- **`requireTLS: true` added to the SMTP transport** (`email.service.ts`) — without it, nodemailer's default "opportunistic STARTTLS" silently falls back to plaintext if the server doesn't advertise STARTTLS, sending the SMTP password and employee PII unencrypted with no error.
- **"Report Downloaded" is now audit-logged** (`reports.controller.ts`, both `image` and `pdf` handlers) — spec §21 requires this action be audited; only email sends were logged before.
- **`getSignedDownloadUrl` wired into a real endpoint** (`GET /reports/email-logs/:id/download`) — this method existed but was never called from anywhere, undercutting the documented promise that a previously-emailed report "can be resolved by re-serving the exact file."
- **Duplicate-record risk on ambiguous network failure, closed with a proper idempotency key.** New finding: if a movement request is sent, the server commits it, but the response is lost before the client reads it, the client's retry (including the offline queue's auto-confirm-on-sync path added in the 2026-09-04 audit) would create a second, genuinely duplicate ENTRY/EXIT with no guard awareness. Fixed with a `clientRequestId` (new `movement_records.client_request_id`, unique, migration `20260909113728`) generated once per guard tap and reused across every retry of that same tap (confirm-resubmit, offline enqueue, sync retry). `MovementsService.createMovement` now checks it first and returns the existing record on replay instead of creating a duplicate; also handles the race where two near-simultaneous retries both pass the check before either commits (catches the resulting unique-constraint violation and treats it the same as a normal replay). Verified live: submitting the same `clientRequestId` twice returns the same record id both times, and exactly one row exists in the database afterward.
- **A lightweight global exception filter added** (`backend/src/common/filters/all-exceptions.filter.ts`, registered in `main.ts`) — spec §62 asks for backend error logging across DB/auth/report-generation/unexpected failures; previously only two services (`email`, `reports`) had any logging at all. Every uncaught exception is now logged with method/path/status/userId, at `error` level for 5xx and `warn` for 4xx, without ever leaking a raw stack trace to the client.
- **Fixed a broken production build**: `scripts/import-employees.ts` (used only for `npm run import:employees` via `ts-node`, not meant to ship) wasn't excluded from `tsconfig.build.json`, and being outside `src/` shifted TypeScript's inferred `rootDir`, nesting all compiled output under an extra `dist/src/` — which broke the report-download feature at runtime (`ENOENT` looking for the logo asset at the old expected path). Fixed by excluding `scripts/**/*` and setting `rootDir: "./src"` explicitly. **Note**: after this fix, `nest build` became intermittently unreliable in this environment — sometimes emitting only a partial `dist/` with no error output, reproduced identically in both Git Bash and PowerShell. Root cause not conclusively identified (suspected antivirus/OneDrive file-lock interference on Windows); a clean retry (`rm -rf dist tsconfig.tsbuildinfo` then rebuild) has succeeded every time so far. Documented in `docs/developer-guide.md`'s troubleshooting table.

### Security — Row Level Security enabled on all 11 Supabase tables

- User-supplied screenshot of Supabase's Security Advisor showed 11 errors: every `public`-schema table had RLS disabled. Supabase auto-exposes every such table through its own REST/GraphQL API (PostgREST) regardless of this app's own auth — anyone holding the project's `anon`/`service` key could potentially read or write `users`, `employees`, `movement_records`, etc. directly, completely bypassing the NestJS backend.
- Verified this app's own access is unaffected before fixing: confirmed via a direct query that Prisma connects as the `postgres` role, which owns every table (`current_user = tableowner = 'postgres'`) — Postgres exempts table owners from RLS by default, so enabling it blocks only *other* roles (exactly Supabase's PostgREST anon/authenticated roles, which this app never uses).
- Migration `20260909120000_enable_row_level_security` enables RLS with no policies (default-deny for any non-owner role) on all 9 Prisma-modeled tables plus `session` (created at runtime by `connect-pg-simple`) and `_prisma_migrations` (Prisma's own tracking table) — both live in `public` and were flagged by the same scan. Verified live afterward: `relrowsecurity: true` on all 11 tables, and a normal Prisma query (`employee.count()`) still succeeds.

### Documentation

- **Consolidated `docs/running-locally.md` into `docs/developer-guide.md`**, per user request to reduce duplicated content across docs — the two had near-identical start-server commands and the same seeded-login table. `developer-guide.md` now has both the first-time setup and a "day-to-day: starting the servers again" section with the merged troubleshooting table; `running-locally.md` deleted, its one inbound link (`docs/README.md`) removed. Checked other likely-duplicate candidates (the two email docs, Supabase setup instructions, the three role-based user guides) and found they already cross-link rather than repeat content — left as-is.

## 2026-09-07 — Switched email sending from Resend to SMTP (Microsoft 365)

### Changed

- **Email provider switched from Resend to SMTP**, per user request to avoid dependency on any vendor's free tier that could change terms and silently break email sending. Checked `adage-automation.com`'s public MX records directly — confirmed the domain already runs on **Microsoft 365** — so instead of picking a new third-party vendor, email now sends through Adage's existing (already-paid-for) mailbox infrastructure via SMTP. This was also compared against Amazon SES (the other rug-pull-resistant option, since SES never had a free tier to begin with) — SMTP won on setup simplicity given the tenant already exists.
- `backend/src/email/email.service.ts` rewritten to use `nodemailer` over SMTP (`smtp.office365.com:587`, STARTTLS) instead of the Resend SDK. Kept the same lazy-client-construction pattern as before (a missing/invalid config only fails the send call, never crashes the app at boot) and the same on-demand-only invocation contract (still only ever called from `POST /reports/email`).
- `backend/package.json` — removed `resend`, added `nodemailer` + `@types/nodemailer`.
- `backend/.env` / `.env.example` — `EMAIL_API_KEY` replaced with `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`; `EMAIL_FROM`/`SECURITY_EMAIL` updated from the placeholder `@adage.com` domain to the real `@adage-automation.com` domain (matching the 6 real employee emails already in the database). Updated the live `SECURITY_EMAIL` setting row in Supabase to match, and the same default in `seed.ts` for future fresh databases.
- `docs/email-provider-options.md` updated with a "Decided" banner at the top and the rug-pull-resistance reasoning that led to SMTP over Resend/SendGrid/SES.
- New `docs/email-m365-admin-handoff.md` — exact, ready-to-send instructions for whoever administers Microsoft 365 for `adage-automation.com`: confirm/create the `security@` mailbox, enable Authenticated SMTP for it specifically (tenant-wide legacy SMTP AUTH has been off by default since 2022), handle MFA via an app password, and send back the mailbox address + password.
- Every other doc referencing Resend/`EMAIL_API_KEY` swept and updated to reflect SMTP: root `README.md`, `docs/README.md`, `docs/architecture.md`, `docs/database-schema.md`, `docs/api-reference.md`, `docs/developer-guide.md`, `docs/deployment.md`, `docs/branding-and-data-needed.md`. `docs/roadmap.md` restructured with a new "Blocked — waiting on external input" section covering both this and the still-pending Supabase Storage credentials, since both are code-complete but unverifiable until real credentials arrive.

### Status

Code-complete, backend builds clean. **Not yet verified against a real send** — `SMTP_PASS` is still blank pending the Microsoft 365 admin handoff. This is the same "code ready, blocked on external input" pattern used earlier for Supabase (see 2026-09-03 entries) — once credentials arrive, the only remaining step is filling in `.env` and sending one real test email.

## 2026-09-04 — Full audit pass: 3 blocking bugs, 8 real gaps fixed

A full three-part audit (backend, frontend, docs) was run over the entire codebase as it stood after several days of feature work, at the user's request ("do a proper audit of everything we have done"). All findings were independently verified against actual current file contents before being trusted, and every fix below was confirmed live against the running app afterward (not just "should work").

### Fixed — blocking

- **Login rate limiting was completely non-functional.** `@Throttle({...})` on `AuthController.login` only sets metadata — without `ThrottlerGuard` actually registered, it enforced nothing, despite a code comment and `docs/security.md` both claiming otherwise. Fixed by adding `{ provide: APP_GUARD, useClass: ThrottlerGuard }` to `app.module.ts`. Verified live: the 6th rapid bad-login attempt now returns `429`, the first 5 return `401`.
- **`GET /employees/:id` required `MANAGE_EMPLOYEES`, which Security doesn't hold — silently broke the Employee Details page (and therefore EMAIL DETAILS) for the Security role.** The Dashboard's "View Employee Day" link is reachable by Security (gated only on `VIEW_EMPLOYEE_HISTORY`), but the employee-header fetch it depends on was 403ing and being swallowed by a `.catch(() => setEmployee(null))` — no visible error, just a blank card and a missing EMAIL DETAILS button. Fixed: `employees.controller.ts`'s `findOne` now requires `VIEW_EMPLOYEE_HISTORY` instead. Verified live: Security's session now gets `200` on `GET /employees/:id` (was `403`).
- **A failed Resend email send was recorded as `SENT` and reported "✓ Details emailed successfully" — with no email actually delivered.** Resend's SDK resolves to `{ data, error }` for API-level failures (unverified domain, invalid recipient, account issues) rather than throwing; only transport failures reject the promise. The code only had a try/catch, never checked `result.error`. Fixed in `email.service.ts` to throw when `result.error` is present, so `ReportsService`'s existing failure-handling path (mark `email_logs` `FAILED`, audit-log `EMAIL_FAILED`) actually triggers. Directly contradicted the project's own stated principle ("never falsely report success").

### Fixed — real gaps

- **`trust proxy` was never configured** (`main.ts`) — `req.ip` returns the reverse proxy's own address on every suggested deploy target (Railway/Render/Fly.io), breaking audit-log IP capture and, worse, meaning the now-working rate limiter would key every user off the same proxy IP in production — one bad actor locking out everyone. Fixed: `app.getHttpAdapter().getInstance().set('trust proxy', 1)`.
- **`CorrectMovementDto.correctionReason` accepted an empty string** — only `@IsString()`, no `@IsNotEmpty()` — silently defeating the "reason is required, kept in audit log" design goal for anyone bypassing the frontend. Fixed. Verified live: `correctionReason: ""` now returns `400`.
- **`CorrectMovementDto.movementAt` accepted any string**, not just a valid date — an invalid value reached `new Date(...)` unchanged, producing `Invalid Date` and an uncaught Prisma error (raw 500) with no exception filter to catch it. Fixed with `@IsISO8601()`. Verified live: `movementAt: "not-a-date"` now returns `400`.
- **`correctMovement`/`addMissingRecord` never verified the target employee exists** (unlike `createMovement`, which does) — a stale/invalid `employeeId` threw an unhandled FK-violation error (raw 500) instead of a clean 404. Fixed with the same existence check `createMovement` already had. Verified live: a nonexistent employee ID now returns `404`.
- **A report-generation failure during "Email Details" left zero trace** — the PNG was generated *before* the `email_logs` row was created, so a Puppeteer crash/timeout threw before any row existed, directly undermining `email_logs`' documented purpose ("lets administrators know whether a requested record was successfully emailed"). Fixed by creating the `PENDING` row first, then generating the PNG inside the existing try/catch.
- **Latent AND-vs-OR bug**: `MovementsController.create` declared `@RequirePermissions('RECORD_ENTRY', 'RECORD_EXIT')` for the one endpoint handling both movement types — `PermissionsGuard` ANDs multiple required permissions, so this silently demanded a guard hold *both* to record *either* one. Harmless today (every role with one has both) but would have silently broken a future entry-only/exit-only role split — exactly the scenario the permission system exists to make cheap. Fixed: permission is now checked per `dto.movementType` inside the handler. Verified live: HR recording an EXIT still works correctly under the new check.
- **Offline movement queue could get permanently stuck with no way to resolve it.** A movement queued while offline is never actually confirmed against the duplicate-check (impossible without a server round trip) — `syncPending()` only removed an item from the queue when the server returned `created: true`, but never handled the `requiresConfirmation: true` response shape at all. A genuinely duplicate offline tap (e.g. guard taps ENTRY twice while offline) would sync, get rejected pending confirmation, and then sit in the queue forever with `pendingCount > 0` and no UI anywhere to inspect or resolve it. Fixed: on `requiresConfirmation`, `syncPending` now retries once with `confirmed: true` — the guard's original offline tap is the only signal of intent available during a background sync, so it's treated as confirmation. Also fixed a misleading code comment claiming offline items were "already confirmed by guard before queueing" (they weren't — `confirmed` always defaulted to `false` on the primary offline path).
- **Dashboard/Corrections/EmployeeDetails default dates used UTC, not local time** — `new Date().toISOString().slice(0, 10)` takes the UTC calendar date, which is *yesterday's* date for the first ~5.5 hours of every single day in Asia/Kolkata (the system's stated timezone authority). Silently wrong exactly when a night-shift handover might be checking "today's" records. Fixed with a new shared `frontend/src/utils/date.ts` (`todayIso`/`isoDaysAgo`) using the browser's local date instead, replacing three separate ad hoc UTC-based implementations.
- **Validation error arrays rendered as unreadable mashed text.** Nest's `ValidationPipe` returns `message` as `string[]` on a 400; every frontend catch block did `err?.message ?? 'fallback'` assuming a string, so a validation failure would render as e.g. `"email must be an emailusername should not be empty"` with no separators. Fixed in `frontend/src/api/client.ts` — array messages are now joined with `, `.
- **No confirmation before an Admin disables their own account** — a possible unrecoverable lockout (if they're the only enabled Admin) with zero warning, client or server side. Fixed with a `window.confirm` warning in `Users.tsx` when the target of a "disable" action is the currently logged-in user. Also added missing try/catch around both `Employees.tsx` and `Users.tsx`'s `toggleActive` — a failed activate/deactivate/enable/disable previously failed completely silently.

### Deliberately not fixed this session (tracked in `docs/roadmap.md` instead)

Puppeteer launching a fresh browser per report (scale concern, not urgent at today's volume); offline+app-restart-mid-outage lockout (needs an architectural decision, not a quick fix); accessibility gaps (no focus trap/Escape on modals); loading-vs-empty-state flash on first render; no request timeout on frontend fetches; `SettingsController` accepting arbitrary keys; unvalidated numeric route params elsewhere falling through to raw 500s (same class of bug as the DTO fixes above, just via route params).

### Documentation fixes (from the docs-consistency audit)

- `docs/database-schema.md` was **factually wrong** — still claimed `role_permissions` grants every permission to every role, directly contradicting the RBAC narrowing from earlier the same day. Fixed, now describes the actual current mapping.
- `docs/roadmap.md` had completed items (CSV import, Corrections UI, Audit Log UI, branding) filed under a `## Not started — features` heading, and a "Suggested next step" telling the reader to go build screens that were already done four lines above. Restructured the whole file.
- `docs/roadmap.md`'s seed-script description was stale (still described creating sample employees/movements, which stopped happening once real employee data existed).
- `docs/user-guide-admin.md` claimed Employees was Admin-only (HR has it too) and omitted Audit Log from its own screen list; also described Department/Designation form fields that were removed from the UI.
- `docs/testing.md` still had a stale "even though v1 grants everything by default" aside.
- Five broken internal markdown anchor links across `docs/database-schema.md`, `docs/security.md`, and `docs/decisions.md` (mismatched heading slugs, and one link to a heading that never existed) — fixed, including simplifying one overly-long heading in `docs/architecture.md` at the source rather than just working around its ugly auto-generated slug.

## 2026-09-04 — Role-based access (RBAC narrowed from v1-flat)

### Changed

- Replaced the original "every role gets every permission" v1 default with a differentiated mapping, per explicit user request: **SECURITY** = record-movement workflow + Dashboard only (no Employees/Users/Corrections/Audit Log/Settings). **HR** = same as Security, plus Employees. **ADMIN** = unchanged, everything. See [docs/decisions.md](./docs/decisions.md#rbac-narrowed-from-v1-flat-2026-09-04) for the full mapping and rationale, including why `RECORD_ENTRY`/`RECORD_EXIT`/`VIEW_EMPLOYEE_HISTORY`/`SEND_EMAIL` stayed on all three roles.
- `backend/src/common/constants/permissions.ts` — `DEFAULT_ROLE_PERMISSIONS` updated to the new mapping (affects `npm run seed` on a fresh database going forward).
- **Live database reconciled directly** — `seed.ts`'s `upsert` with `update: {}` never removes existing grants, so a one-off script deleted the now-revoked `role_permissions` rows (4 for Security: `MANAGE_EMPLOYEES`/`MANAGE_USERS`/`MANAGE_SETTINGS`/`CORRECT_RECORDS`; 3 for HR: `MANAGE_USERS`/`MANAGE_SETTINGS`/`CORRECT_RECORDS`) rather than relying on re-seeding.
- `frontend/src/components/AdminNav.tsx` — each link now conditionally renders based on `useAuth().hasPermission(...)`, so Security sees only "Record Movement" + "Dashboard", HR additionally sees "Employees", and only Admin sees the rest.
- `frontend/src/components/ProtectedRoute.tsx` — gained an optional `permission` prop; redirects to `/` if the logged-in user lacks it. Explicitly documented as a UX convenience, not the security boundary — `PermissionsGuard` on the backend is the real enforcement regardless of what this component does.
- `frontend/src/App.tsx` — every admin route (`/employees`, `/users`, `/corrections`, `/audit-log`, `/settings`) now passes the matching `permission` to `ProtectedRoute`; `/dashboard` and `/employee-details` gated too, for defense in depth (all three roles currently hold those permissions, so this doesn't change behavior today).

### Verified

- Backend: confirmed directly via API calls (not just trusting the UI) — Security's session gets `403` on `GET /users` and `GET /employees`, `200` on `GET /dashboard/summary`; HR's session gets `200` on `GET /employees`.
- Frontend: screenshotted the nav bar for all three roles (Security shows 2 links, HR shows 3, Admin shows all 7) and confirmed a direct URL navigation to `/users` as Security or HR redirects to `/` while Admin reaches it — proving the route guard, not just the hidden nav link, is doing the real work.

## 2026-09-04 — Record Correction and Audit Log screens

### Added

- **`frontend/src/pages/Corrections.tsx`** — the first UI for the previously API-only correction endpoints. Search an employee (including inactive ones, via `/employees/search-all`, per spec §39/§42), pick a date, see that day's movements, and either "Correct" an existing record or "Add Missing Record" via a modal (movement type, time, and a required reason — enforced client-side, stored in the audit log). Confirmed the append-only correction model still holds: a corrected record disappears from the list (superseded) and the new corrected row takes its place.
- **`frontend/src/pages/AuditLog.tsx`** — a read-only viewer for `GET /audit-logs`, with Entity Type and Performed By filters and a "Load More" pager. Action names are color-coded (green for creates/logins, amber for corrections/deactivations, red for failures).
- **`frontend/src/components/AdminNav.tsx`** — a shared nav-links block (Record Movement, Dashboard, Employees, Users, Corrections, Audit Log, Settings), replacing six near-duplicate copies of the same links across Dashboard/Employees/Users/Settings/Corrections/AuditLog.
- Backend: `MovementsService.summaryForDate` now returns `currentlyInside` (last-recorded ENTRY-without-EXIT for the selected date). `GET /audit-logs` now accepts `skip`/`take` for pagination and includes the acting user's name in the response (`AuditLogService.list` now `include`s the `user` relation — previously omitted).
- Three new icons (`IconEdit`, `IconPlus`, `IconHistory`) plus `IconDoorOpen`/`IconX` from the dashboard work.

### Fixed

- Dashboard filter inputs (Date/Employee/Movement) were rendering unstyled — spotted from a user screenshot, root-caused to those inputs never being wrapped in the shared `.field` class. Fixed, plus added a new "Currently Inside" 4th summary card and Today/Yesterday quick-date buttons.

### Verified

- Full live walkthrough via Puppeteer against the running app: logged in as Admin, searched for and selected an employee (including the inactive-employee search path), added a missing record through the modal, confirmed the success banner and updated record list, then checked the Audit Log page showed the resulting `MISSING_RECORD_ADDED` entry attributed to the correct user. The test movement record created during this walkthrough was deleted afterward so it doesn't pollute the real employee data now in the database.

## 2026-09-03 — Dashboard redesign + fixed unstyled filters bug

### Fixed

- **Dashboard's Date/Employee/Movement filter inputs were rendering as bare, unstyled native browser controls** (no border, padding, or focus ring) — spotted from a user screenshot. Root cause: those inputs were never wrapped in the `.field` class every other input in the app uses. Fixed by wrapping them properly and adding a `.filters-bar .field { margin-bottom: 0 }` override so the fix doesn't add unwanted vertical spacing in the horizontal filter bar.

### Added

- **"Currently Inside" summary card** on the Dashboard — a 4th stat alongside Total Employees/Entries/Exits, computed as employees whose most recent movement on the selected date was an ENTRY (i.e. not yet recorded leaving). Backend: `MovementsService.summaryForDate` now returns `currentlyInside`. For a past date this reads as "not exited by end of that day" rather than a live count — labeled accordingly in the UI.
- **Quick date buttons** ("Today" / "Yesterday") next to the date picker, highlighting whichever is currently selected.
- **Employee filter chip** — once an employee is selected in the Dashboard filter, it now renders as a filled chip with an inline "×" to clear, instead of the previous plain "✕ Clear ..." text link below the input.
- Two new icons: `IconDoorOpen` (currently-inside card), `IconX` (chip clear button).

### Verified

- Visually confirmed via Puppeteer screenshots against the live app: filters now show proper borders/focus states, the 4-card grid renders correctly at desktop width, quick-date buttons toggle active state, and the employee chip + "View Employee Day" link work together without layout overlap (an intermediate version had the date field and quick buttons overflowing into the employee column at 1300px width — fixed by giving the date field a larger flex-basis and letting the quick-date buttons wrap).

## 2026-09-03 — Test data cleanup, dropped department/designation

### Removed

- **Permanently deleted** the 4 fake seeded test employees (Rahul Sharma, Rahul Patil, Amit Patil, Priya Nair) and their dependent rows (6 movement records, 1 email log), per user request — a deliberate one-off exception to the app's normal soft-delete-only rule for employees, justified because these were seed/test data, not real former staff. Verified no employees remain with those codes; the 6 real employees are unaffected.
- `department` and `designation` fields removed from the "Add Employee" form (`frontend/src/pages/Employees.tsx`) and from the employee list table — confirmed via code search they weren't referenced anywhere in search, filtering, or report generation, so they were pure unused metadata. The database columns remain (nullable) in case they're wanted later; nothing currently requires populating them. CSV import format simplified accordingly to `employee_code,employee_name,email`.
- Renamed the seeded dev "security" login account from "Rahul Sharma" to "Security User" (and its DB row updated to match) — it previously borrowed the name of a fake test employee, which was confusing now that that employee no longer exists.

### Changed

- `backend/prisma/seed.ts` no longer creates sample employees or sample movement records — only roles/permissions/settings/dev-user accounts, which are still needed for login. This prevents a future `npm run seed` re-run from silently recreating the just-deleted test data now that the database holds real employee records.

## 2026-09-03 — First real employee data

### Added

- `backend/scripts/import-employees.ts` — reusable CSV employee import (spec §41), run via `npm run import:employees -- <path-to-csv>`. Validates every row (required fields, email format, duplicate employee codes) before writing anything; upserts by employee code so re-running a corrected file is safe. This was a planned-but-not-built roadmap item, built now instead of as a one-off script since more employee batches are expected.
- `backend/data/employees-import.csv` — the source file for the first real import.
- Imported the first 6 real employees, provided by the user: Shivani R Naik (55668), Bala Dattaprasad Patwardhan (55778), Pranav P Naik (55714), Raj Ramanand Fal Dessai (55715), Sai Sanjay Kunkalienkar (55777), Adarsh Bhaskaran Chanabhat (55602). Department/designation left blank — not yet supplied.

### Changed

- Deactivated the 4 fake seeded test employees (Rahul Sharma, Rahul Patil, Amit Patil, Priya Nair) — `isActive: false`, per user request. Their test movement history is preserved (soft delete, matches the app's design) but they no longer appear in the guard's search. Verified via a live API call that search now returns only the real employees.

## 2026-09-03 — Deeper design pass

### Added

- `frontend/src/components/icons.tsx` — a small inline SVG icon set (search, entry/exit, dashboard grid, mail, check/alert/clock/x circles, users, settings gear, calendar, chevron, inbox, wifi-off, arrow-left, log-out) so the UI stops relying on emoji/text-only affordances, with no external icon library dependency.
- Empty states (icon + title + hint) for: no employee selected yet on the Security screen, no search matches, no dashboard records, no movement records for an employee/date.
- Micro-interactions: fade/slide-in animations on page load, status banners, search results, and modals; a pop-in animation on the selected-employee card and login card; hover-lift on summary cards; a reusable spinner (light and dark variants) replacing plain "…" loading text.
- `.status-pill` (Active/Inactive, Active/Disabled with a dot indicator) and `.table-action-btn` / `.section-card` patterns, applied consistently across Employees, Users, and Settings admin screens — replacing ad hoc plain-text status and unstyled buttons.
- Avatar-initial circles in the employee search results dropdown (both the Security screen and the Dashboard's employee filter), and on the Employee Details page.

### Changed

- Every icon-bearing element (ENTRY/EXIT buttons, nav links, dashboard button, status banners, summary cards, action-row buttons) now pairs an icon with its label instead of text alone.
- Visually verified in a real headless browser (Puppeteer, since `chromium-cli` wasn't available in this environment) against the live app: login page, Security home (empty state, search results, selected-employee state), and Dashboard — screenshots reviewed and sent to the user, no console errors beyond the expected pre-login 401.

## 2026-09-03 — Real logo, removed download buttons

### Added

- Wired in the real Adage logo (`Adage_Logo.png`, supplied by the user) throughout the app:
  - Sampled the exact brand teal directly from the logo file: `#0d828b` (previous placeholder `#0f766e` replaced everywhere — CSS variables, PWA theme color/manifest).
  - Header and Login screen now render the actual logo image (`frontend/public/logo.png`) instead of the placeholder text-based "A" badge; header renders it in white via a CSS mask since it sits on a dark teal background.
  - Generated real square PWA icons (`icon-192.png`, `icon-512.png`) from the logo, replacing the 1×1 placeholder PNGs.
  - Embedded the logo (as a base64 data URI, read from `backend/src/reports/assets/adage-logo.png`) into the emailed/downloaded PNG/PDF report template, replacing the plain "ADAGE" text header. Added an `assets` copy rule to `nest-cli.json` so the image ships correctly in production builds (`dist/reports/assets/`).

### Removed

- The "DOWNLOAD IMAGE" and "DOWNLOAD PDF" buttons on the Employee Details screen, per user request — only "EMAIL DETAILS" remains on that screen. The underlying `GET /reports/image` / `GET /reports/pdf` API endpoints are untouched and still work (report generation is also used internally for the email attachment) — they're just no longer exposed as buttons in the UI. Documented as API-only in `docs/api-reference.md`.

### Fixed

- **Report PNG/PDF downloads were silently corrupted** — Puppeteer's `page.screenshot()`/`page.pdf()` return a `Uint8Array`, not a true Node `Buffer`; Express's `res.send()` only sends raw binary when `Buffer.isBuffer()` is true, and silently JSON-serializes anything else. The result: `GET /reports/image`/`GET /reports/pdf` were returning a JSON object of numeric byte-index keys instead of an actual image/PDF (verified — the PNG magic bytes were present but wrapped in `{"0":137,"1":80,...}`). Fixed by explicitly wrapping both results in `Buffer.from(...)` in `ReportGeneratorService`. Confirmed fixed by downloading and viewing a real report end-to-end against the live database — correct layout, correct logo, correct data.
- The lazy-loaded report logo (added this session, see above) also crashed the app once during this fix, for the same reason as the `EmailService` boot-crash bug from earlier today — caught during testing, not shipped.

### Documentation

- `docs/email-provider-options.md` — comparison of Resend (current default), SendGrid, Amazon SES, and SMTP for the on-demand email feature, with a recommendation to stick with Resend unless Adage has an existing AWS/vendor preference.
- Updated `docs/branding-and-data-needed.md` to reflect the logo/brand-color items as resolved.

## 2026-09-03 — UI redesign (teal branding placeholder)

### Added

- Full CSS design-system rework in `frontend/src/styles/global.css`: teal color palette (`--brand: #0f766e`, `--brand-light: #14b8a6`) as a placeholder for the real Adage brand teal, Inter typeface (Google Fonts), consistent shadow/radius scale, gradient buttons, sticky header, hover/active states throughout, and a reusable `.logo-mark` teal badge component used in both the header and login screen in place of plain text.
- `docs/branding-and-data-needed.md` — the definitive list of what only Adage can supply: real logo files, exact brand hex, real employee/user data, email-sending domain, storage bucket, and deployment domain.
- Employee avatar initials on the SecurityHome selected-employee card.

### Note

- The teal used (`#0f766e`) is a reasonable placeholder, not Adage's confirmed brand color — swap it once supplied (see `docs/branding-and-data-needed.md`).

## 2026-09-03 — First live database run

### Added

- Provisioned the Supabase project, applied the first real migration (`prisma migrate dev --name init`) against it, and ran the seed script — the schema is now live in Mumbai (ap-south-1), no longer just syntax-validated.
- Manually verified the full core workflow against the live database: login establishes a real session, `/employees/search` returns live data, `POST /movements` records real rows, the confirm-before-save duplicate-warning flow (§43) behaves correctly end to end (blocks the duplicate, then accepts it once confirmed), `/dashboard/summary` reflects the recorded movements, and `/audit-logs` shows the corresponding entries.
- Learned that Supabase's direct connection host (`db.<ref>.supabase.co:5432`) resolves IPv6-only; on networks without IPv6 this is unreachable. Fix: use the session-mode pooler connection (`aws-0-<region>.pooler.supabase.com:5432`, username `postgres.<project-ref>`) instead — documented in `docs/deployment.md`.

### Fixed

- **`EmailService` crashed the entire backend at boot** if `EMAIL_API_KEY` wasn't set, because the Resend client threw synchronously in the constructor — meaning the whole app (auth, movements, dashboard, everything) was unusable without email configured. Fixed by constructing the client lazily, only when an email is actually sent; the app now boots fine with email unconfigured and only errors (into `email_logs.errorMessage`, not a crash) if something tries to actually send.
- **`AuditLogModule` wasn't global**, so `EmployeesModule`, `MovementsModule`, `UsersModule`, and `SettingsModule` failed to resolve their `AuditLogService` dependency at boot (Nest dependency-injection error). Fixed by marking `AuditLogModule` `@Global()`, consistent with `PrismaModule` — appropriate since nearly every module writes to the audit trail.
- **Login appeared to succeed (200 OK, user returned) but never actually established a session** — no `Set-Cookie` header was ever sent, so every subsequent request was treated as unauthenticated. Root cause: `@nestjs/passport`'s `AuthGuard` validates credentials but does not call `req.logIn()` on its own; this has to be done explicitly. Fixed by overriding `LocalAuthGuard.canActivate` to call `super.logIn(request)` after the base guard succeeds — a well-known but easy-to-miss NestJS + Passport + session gotcha.


All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/), dated by day rather than by release version since there is no released version yet.

## 2026-09-03 — Database provider decision

### Decided

- Database provider: **Supabase Postgres, Mumbai (ap-south-1) region** — chosen over Neon (no Mumbai region), Railway (US/EU only), and AWS RDS (more ops overhead, only preferable if Adage is already AWS-standardized). See [docs/decisions.md](./docs/decisions.md#database-provider-supabase-mumbai) for full rationale.
- Supabase Storage (bundled, S3-compatible) is the recommended target for the `STORAGE_*` env vars used to persist emailed reports, in place of a separately provisioned AWS S3/Cloudflare R2 bucket — no code changes required, `StorageService` already speaks the generic S3 API.

### Updated

- `README.md`, `docs/deployment.md`, `docs/developer-guide.md`, `backend/.env.example` — all now point at Supabase specifically instead of listing Postgres/storage providers generically.

## 2026-09-03 — Initial scaffold

### Added

- Monorepo structure: `backend` (NestJS + Prisma), `frontend` (React + Vite + PWA), `docs`.
- **Database**: Prisma schema for `roles`, `permissions`, `role_permissions`, `users`, `employees`, `movement_records` (event-log model with append-only correction chain), `email_logs` (with persisted-report tracking), `audit_logs`, `settings`. Dev seed script creating 3 users (ADMIN/HR/SECURITY), sample employees, and sample movement records.
- **Backend — Auth**: session-cookie login/logout/me via `passport-local` + `express-session` (Postgres-backed store), Argon2 password hashing, login rate limiting.
- **Backend — RBAC**: `SessionAuthGuard` + `PermissionsGuard` + `@RequirePermissions` decorator applied to every route; permission constants centralized in `common/constants/permissions.ts`; v1 grants all permissions to all three roles.
- **Backend — Employees**: search (active-only for guards, all-inclusive for corrections), CRUD, deactivate/reactivate (soft delete).
- **Backend — Movements**: server-authoritative timestamps, confirm-before-save duplicate-movement warning, filterable listing, append-only record correction, missing-record addition.
- **Backend — Dashboard**: daily summary counts (employees/entries/exits), no working-hours calculation.
- **Backend — Reports**: HTML/CSS template rendered via Puppeteer to PNG and PDF; on-demand-only email send via Resend with the sent PNG persisted to S3-compatible storage and referenced from `email_logs`.
- **Backend — Users/Roles/Permissions/Settings/Audit-logs**: admin management modules, all write actions logged to the audit trail.
- **Frontend**: Login page; SecurityHome (search → select → ENTRY/EXIT core workflow, duplicate-confirmation modal, offline IndexedDB queue with a visible "pending sync" state); Dashboard (date/employee/movement-type filters, summary cards, responsive table→card layout); EmployeeDetails (per-day movement view, PNG/PDF download, on-demand EMAIL DETAILS with resend confirmation); Employees/Users/Settings admin pages.
- **PWA**: web app manifest and service worker via `vite-plugin-pwa`; placeholder icons pending real branding assets.
- **Documentation**: full `docs/` set — architecture, database schema, API reference, security model, role-based user guides (Security/HR/Admin), developer guide, testing checklist, deployment checklist, architecture decisions log, and roadmap.

### Verified

- Backend builds cleanly (`npm run build`, zero TypeScript errors).
- Frontend builds cleanly (`npm run build`, zero TypeScript errors).
- Prisma schema validated (`npx prisma validate`, `npx prisma generate`).

### Known gaps (tracked in `docs/roadmap.md`)

- No real database has been provisioned or migrated against yet — everything is verified at compile time only.
- Forgot-password flow is a non-functional UI placeholder.
- CSV/Excel employee import not implemented.
- No dedicated UI yet for record correction or the audit-log viewer (API-only for now).
- No automated tests exist yet.
- No CI pipeline or deployment configured yet.
- PWA icons and login-screen branding are placeholders, not real Adage assets.
