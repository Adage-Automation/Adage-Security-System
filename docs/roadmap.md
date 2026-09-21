# Roadmap / Task List

Status as of 2026-09-21. Grouped by area, roughly in priority order within each group. See [Audit findings](#audit-findings-2026-09-04) below for the historical 2026-09-04 audit, [2026-09-21 audit](#2026-09-21--full-codebase-audit-bugs-crashes-offlinenetwork-edge-cases) for the most recent one, and `CHANGELOG.md` for the full dated history of everything since.

**Context**: this system is a secondary/backup attendance record, not the primary one — employees punch their own attendance in a separate app, FactoHR, which stays the system of record. This app exists because security guards independently log entry/exit times at the gate; HR uses it to reconcile a missed FactoHR punch or a disputed time. See `docs/architecture.md`. This framing is why an attendance/payroll roll-up is deliberately out of scope here (see "Working hours" in the Done list below) and why no FactoHR integration is planned.

## Done

- [x] Role-based access control — Security/HR/Admin now hold different permissions (narrowed from the original flat v1 default), enforced server-side and reflected in the nav/route guards client-side. See [decisions.md](./decisions.md#rbac-narrowed-from-v1-flat-2026-09-04).
- [x] Repo structure (`backend`, `frontend`, `docs`)
- [x] Prisma schema: roles, permissions, role_permissions, users, employees, movement_records (event log + append-only corrections), email_logs (with persisted report URL), audit_logs, settings
- [x] Seed script — roles/permissions/settings/dev-user accounts only (no longer seeds sample employees or movements as of 2026-09-03, once real employee data existed)
- [x] Session-based auth (login/logout/me), Argon2 hashing, **login rate limiting — actually enforced as of 2026-09-04** (the `@Throttle` decorator existed since the start but `ThrottlerGuard` was never registered, so it silently did nothing; fixed in the audit, verified live: 6th rapid attempt returns 429)
- [x] Permission-guard infrastructure (`SessionAuthGuard`, `PermissionsGuard`, `@RequirePermissions`) applied to every route
- [x] Employees module: search (active-only + admin all-inclusive), CRUD, deactivate/reactivate
- [x] Movements module: create with server-authoritative timestamp, confirm-before-save duplicate warning, filterable list, append-only correction, missing-record addition
- [x] Dashboard summary endpoint (counts + "Currently Inside", no working-hours math)
- [x] Reports: Puppeteer HTML→PNG/PDF template, on-demand-only email send through Adage's existing Microsoft 365 tenant (Resend → SMTP on 2026-09-07 → Microsoft Graph API/OAuth2 on 2026-09-10, once M365 confirmed basic-auth SMTP is retired — see [decisions.md](./decisions.md)), persisted-to-storage attachment, email_logs
- [x] Users/Roles/Permissions/Settings/Audit-logs admin modules
- [x] Frontend: Login, SecurityHome (search→select→ENTRY/EXIT, duplicate-confirm dialog, offline IndexedDB queue with pending-sync UI), Dashboard (filters + summary + responsive table/cards), EmployeeDetails (view + on-demand email with resend confirmation — download buttons removed 2026-09-03 by request), Employees/Users/Settings admin pages, **Corrections** (`/corrections`) and **Audit Log viewer** (`/audit-log`)
- [x] **CSV employee import** (spec §41) — `backend/scripts/import-employees.ts`, run via `npm run import:employees -- <path-to-csv>`. Validates every row (required fields, email format, duplicate codes) before writing, upserts by employee code, title-cases names on import. The canonical format is `employee_code,employee_name,email,car_number`; email and car number may be blank. Started with 6 real employees (2026-09-03); the full 205-person roster was imported 2026-09-09 from `backend/data/employees.csv` (54 of those 205 have no email yet — email is now an optional field throughout, see [decisions.md](./decisions.md) and `docs/branding-and-data-needed.md`).
- [x] Real Adage branding — logo wired in everywhere (header, login, PWA icons, report template); exact brand teal (`#0d828b`) sampled from the logo file. See [branding-and-data-needed.md](./branding-and-data-needed.md) for what's still open (a square mark-only logo variant, not blocking).
- [x] PWA manifest + service worker (`vite-plugin-pwa`)
- [x] Both backend and frontend build cleanly (verified via `npm run build`)
- [x] Full documentation set (this folder + root README/CHANGELOG) — refreshed again after the 2026-09-11 cleanup to reflect the current code, including safe audit-log payload sanitization, timezone validation, and the improved conflict-review UI
- [x] Database provider decided and live: Supabase Postgres, Mumbai (ap-south-1) — see [decisions.md](./decisions.md#database-provider-supabase-mumbai)
- [x] Real `backend/.env` created (never committed) with actual `DATABASE_URL` and a generated `SESSION_SECRET`; email/storage credentials configured — see `docs/decisions.md`'s email-provider entries
- [x] Movement idempotency key (`clientRequestId`) — closes a duplicate-record risk on ambiguous network failures. See [decisions.md](./decisions.md#movement-idempotency-key).
- [x] Row Level Security enabled on every application table (defense in depth; the runtime-created session table is excluded until it exists). See [decisions.md](./decisions.md#row-level-security-defense-in-depth).
- [x] Converted to an **npm workspaces** monorepo — one `npm install` and one `npm run dev` from the repo root runs both apps together, on any machine, not just the one this was built on. See [decisions.md](./decisions.md#npm-workspaces-single-install-single-dev-command).
- [x] Data-file cleanup — consolidated the current roster in `backend/data/employees.csv`, removed a redundant duplicate logo file at the repo root, one lockfile instead of three.
- [x] **Full workflow audit (2026-09-09)** — every user-facing workflow checked end to end (API-level + full UI walkthrough) across all three roles. Found and fixed live: leftover test data in `movement_records`/`email_logs` (deleted), and a real pagination/search gap on the Employees admin screen (155 of 205 employees were unreachable — fixed with search + "Load More" pagination). See `CHANGELOG.md`'s 2026-09-09 (cont. 4) entry.
- [x] Settings key whitelist, `ParseIntPipe`/`parseOptionalInt` on every numeric route/query param, pooled Puppeteer browser instance, and a 20s request timeout on the frontend API client — see `CHANGELOG.md`'s 2026-09-10 entry for details and what each closes.
- [x] Loading-vs-empty-state flash fixed on Dashboard/EmployeeDetails/Corrections — see `CHANGELOG.md`'s 2026-09-10 (cont.) entry.
- [x] **Full "Email Details" flow verified end to end, live (2026-09-10)** — Azure AD app registered, `Mail.Send` admin consent granted, Supabase Storage bucket + keys filled in. Live test: `POST /reports/email` returned `email_logs.status: "SENT"`, the PNG was uploaded to storage, and the signed re-download URL served back a valid 720×530 PNG. Both of the two previously-blocked items are now working — see `CHANGELOG.md` and the note below.
- [x] **Full-codebase crash/bug audit + fixes (2026-09-10)** — five real crash/500 risks found and fixed: an unvalidated `date` URL param crashing EmployeeDetails.tsx with a `RangeError` (no `ErrorBoundary` existed anywhere in the app either — added one as defense in depth); the same unvalidated `date` producing raw 500s instead of clean 400s on every date-filtered endpoint (`GET /movements`, `GET /movements/employee/:id`, `GET /dashboard/summary`, `GET /reports/image`/`pdf`, `POST /reports/email`) — fixed with a shared validated `dayRange()` helper; the pooled Puppeteer browser (added 2026-09-10) had no self-healing if it died mid-session rather than at launch — added a `disconnected` listener; a cleared date field in Corrections showing a raw `"Invalid time value"` error; two unguarded non-null assertions in report generation. See `CHANGELOG.md`.
- [x] **Forgot password (2026-09-10)** — self-service reset-token flow: `POST /auth/forgot-password` (email a single-use, SHA-256-hashed, 1-hour-expiring token; always returns the same generic response regardless of whether the email matched an account, to prevent enumeration) and `POST /auth/reset-password` (validates the token, sets the new password, invalidates the token). New frontend pages `ForgotPassword.tsx`/`ResetPassword.tsx`; the login page's placeholder link now works. Verified live end to end: invalid token → 400, valid token + short password → 400, valid token + valid password → 200 and login succeeds with the new password, same token reused → 400 (confirmed single-use), non-existent email → identical generic response (confirmed no enumeration leak). See [decisions.md](./decisions.md#forgot-password-hashed-single-use-tokens-not-jwt-or-plaintext).
- [x] **Total working hours on the employee day view (2026-09-10)** — `calcWorkingHours()` in `EmployeeDetails.tsx` computes first ENTRY to last EXIT of the day and displays it as a teal banner below the movement list. Frontend-only; no backend change. Hidden when the employee has no EXIT yet for the day.
- [x] **Fixed a real deployment-blocking bug**: migration `20260909120000_enable_row_level_security` unconditionally ran `ALTER TABLE "session" ENABLE ROW LEVEL SECURITY`, but that table only exists once the app has booted once (created at runtime by `connect-pg-simple`). On any genuinely fresh database — a real first production deploy, a CI/shadow database — `prisma migrate deploy` would fail on this exact statement and abort every migration after it, forever. Guarded to a no-op when the table doesn't exist yet. See [decisions.md](./decisions.md#fixing-a-deployment-blocking-migration-a-rare-edit-to-an-applied-migration).

## Audit findings (2026-09-04)

A full three-part audit (backend, frontend, docs) was run against the codebase as it stood after several days of feature work. **All blocking and real-gap findings were fixed the same session** — see `CHANGELOG.md`'s 2026-09-04 entries for the complete list with file references. Highlights:

- Login rate limiting was decorative only (guard never registered) — now actually enforced.
- Security's Employee Details page (and therefore EMAIL DETAILS) was silently broken by a permission mismatch (`GET /employees/:id` required `MANAGE_EMPLOYEES`, which Security doesn't hold) — fixed to `VIEW_EMPLOYEE_HISTORY`.
- A failed Resend email send was recorded as `SENT` and reported success to the user — Resend's SDK doesn't throw on API-level failures, it returns `{ error }`, which was never checked. Fixed.
- The offline movement queue could get permanently stuck with no way to resolve it, if a queued tap turned out to be a duplicate once synced. Fixed to auto-resolve on sync.
- Dashboard/Corrections/EmployeeDetails default dates used UTC instead of local time — wrong for the first ~5.5 hours of every day in Asia/Kolkata. Fixed with a shared `frontend/src/utils/date.ts`.
- Several DTO validation gaps (empty correction reason accepted, invalid date strings reaching Prisma as raw 500s, no employee-existence check on corrections) — fixed.
- A latent AND-vs-OR bug in the movement-recording permission check (`RECORD_ENTRY` + `RECORD_EXIT` both required to record either one) — harmless today since every role with one has both, but would have silently broken a future entry-only/exit-only role. Fixed.
- `trust proxy` was never configured — `req.ip` would return the wrong address in front of any reverse proxy, breaking both audit-log IP capture and (once fixed) per-IP rate limiting in production. Fixed.
- Several stale documentation claims (this file included) — see the docs audit's findings, mostly fixed in this pass.

**Deliberately not fixed in the 2026-09-04 session** (most since closed — see below):
- ~~Puppeteer launches a brand-new headless Chromium process per report generation~~ — fixed 2026-09-10, now pools one browser instance.
- ~~Offline authentication: app couldn't reopen after an offline reload~~ — fixed 2026-09-10: `AuthContext.tsx` caches the last-known user in `localStorage` (12h expiry); offline reloads restore it. See `decisions.md`.
- ~~Duplicate-confirmation and correction modals had no dialog semantics, focus trapping, or Escape handling~~ — fixed 2026-09-10; ARIA `role="dialog"`, `aria-modal`, `aria-labelledby`, initial focus on open, focus trap on Tab, Escape-to-close. A broader color-contrast review remains open.
- ~~Offline duplicate auto-confirmed on sync~~ — fixed 2026-09-10: conflicts surfaced to the guard with a "Record anyway" button instead.
- Minor polish items: ~~loading-vs-empty flash on first render~~, ~~no AbortController/timeout on fetches~~, ~~`SettingsController` accepting arbitrary keys~~, ~~unvalidated numeric route params falling through to raw 500s~~ — all fixed 2026-09-10.
- Audit-log PII review is now done: `audit_logs` stores compact, sanitized JSON payloads instead of full raw objects, with sensitive fields stripped before storage.

## Blocked — waiting on external input

Both prior blockers here were cleared and verified live on 2026-09-10 — see the "Done" list above and `CHANGELOG.md`. Nothing currently in this section.

**One follow-up not yet done** (lower urgency, doesn't block real use): the Exchange Online application access policy (`New-ApplicationAccessPolicy`) restricting the Azure app to only the sending mailbox has not been confirmed run — `Mail.Send` as an application permission can currently send as any mailbox in the tenant until this is applied. See `docs/email-m365-admin-handoff.md` step 5 and `docs/security.md`.

**Also still temporary**: no `security@adage-automation.com` mailbox exists yet — `MAIL_FROM_ADDRESS`/`SECURITY_EMAIL` in `backend/.env` are set to `shivani.naik@adage-automation.com` as a stand-in. Swap both back once that mailbox is created, and re-run the access policy above against it.

## Current status — quality

- [x] Automated tests — backend/frontend Jest coverage now includes auth, password reset, employee search/car-number behavior, movements/idempotency/corrections, dashboard queries, RBAC, Graph failures, storage/report failures, the reports email-success path, and the Employee Details working-hours calculation. Controller-level specs were also added for the Employees and Reports HTTP surfaces; database-backed controller e2e tests remain scaffolded behind `E2E_TEST_DATABASE_URL` for broader workflow coverage when a real test database is available.
- [x] Formal load-test tooling and local benchmark — `npm run load:test` runs an authenticated `autocannon` employee-search benchmark. A local run was captured in this workspace with a conservative single-connection setting: 27 requests in 5.03s, average latency 177.77 ms, no errors.
- [x] Accessibility pass — dialog semantics, focus trapping, initial focus, Escape handling, live status announcements, employee search labels, and now a full ARIA label-association fix (24 fields across 6 pages) plus a formal color-contrast verification (all status/muted text ≥4.6:1, passing WCAG AA) — see `docs/decisions.md`, 2026-09-11.
- [x] Offline auth-cache gap — the cached-user fallback only triggered when `navigator.onLine` was `false`, missing the "online but server unreachable" case (dead backend, DNS hiccup, VPN drop); fixed 2026-09-11, see `docs/decisions.md`.
- [x] `frontend/package.json` declaring its own test dependencies instead of relying on hoisting from `backend` — fixed 2026-09-11.

The remaining items below are intentionally low-priority cleanup work rather than blockers: they are worth revisiting later, but they do not block normal feature use or the existing verified email/report flows.
- [x] Backend timezone hardening for `Asia/Kolkata` (startup validation + runtime `TZ` configuration guidance)
- [x] Offline sync conflict workflow improvements (conflict reasons + dismiss workflow)
- [x] Audit-log PII review and sanitization
- Broader controller/e2e test coverage — database-backed controller e2e tests remain scaffolded behind `E2E_TEST_DATABASE_URL` for when a real test database is available; unit/service-level coverage is already comprehensive (see "Current status — quality" above)
- Optional reports API shape cleanup

## Known simplifications worth revisiting

- **Timezone correctness (backend)**: day-boundary queries (`dayRange` in `movements.service.ts`) rely on the server process's OS timezone being set to `Asia/Kolkata`, and the backend now validates the runtime timezone against `APP_TIMEZONE` in production before it starts. This closes the silent drift risk that used to be a deployment-only footgun. (Note: the equivalent *frontend* bug — default dates computed in UTC instead of local time — was found and fixed 2026-09-04; the backend now handles its own timezone boundary logic explicitly.)
- **Offline sync conflict handling**: queued movements that come back `requiresConfirmation` are now held as explicit conflicts, surfaced with a reason, and can be either intentionally recorded or dismissed by the guard from the red review banner. This is a materially better workflow than the earlier single-action-only banner.
- **Offline + app restart mid-outage**: the app now restores a cached user profile for up to 12 hours whenever `/auth/me` can't be answered — offline, a network failure, or a timeout — rather than only when `navigator.onLine` is `false` (that narrower check missed "online but server unreachable"; fixed 2026-09-11, see `docs/decisions.md`). This allows the recording screen and queue to reopen. The server remains authoritative; cached authentication is not used for online API access, and a real server-issued rejection (401/403) still logs the user out immediately.
- **Reports controller's `email` endpoint uses `@Post` with query params** rather than a request body — consistent with the rest of the reports endpoints (`image`/`pdf` also use query params for `employeeId`/`date`), but worth a second look if this API is ever consumed by something other than the bundled frontend. Left as-is deliberately: changing just one of the three reports endpoints would be inconsistent, and changing all three touches both the API contract and every frontend caller — a coordinated change, not a quick one.

## Infrastructure (deployment) — live since 2026-09-11

- [x] Backend deployed — Render (`https://adage-security-system.onrender.com`)
- [x] Frontend PWA deployed — Vercel
- [x] Production domain (provider-issued subdomains for now, no custom domain yet), HTTPS (terminated automatically by both Vercel and Render), CORS allow-list (`FRONTEND_URL`), production database (Supabase `ap-south-1`), server runtime timezone (`TZ=Asia/Kolkata`, validated at boot — see `docs/architecture.md`)
- [x] Puppeteer's Chromium on Render — found broken live 2026-09-21 (`Could not find Chrome`; Render's build-cache "up to date" fast-path was silently skipping `postinstall`), fixed by installing Chrome as an explicit Build Command step instead. See `docs/decisions.md`'s "Deploying to Render" entry and `docs/deployment.md`'s checklist. Verified: Email Details works end to end in production.
- [x] Keep-alive for Render's 15-min sleep + Supabase's 7-day auto-pause — `GET /api/health` + `.github/workflows/keep-alive.yml`; an external uptime monitor (UptimeRobot free tier recommended) is the suggested primary pinger. See `docs/deployment.md#keeping-it-alive-render-sleep--supabase-auto-pause`.
- [x] CI pipeline (lint + build + test on every push/PR) — `.github/workflows/ci.yml` runs workspace install, backend/frontend lint, backend tests, and the full build. Deployment itself is not automated from CI (a manual/Render-triggered deploy on push).

## 2026-09-21 — full-codebase audit (bugs, crashes, offline/network edge cases)

A complete pass across every backend module and every frontend page, all three roles, requested explicitly ("check the entire code... find any bugs or code that might crash... what can happen if there is internet issue"). 11 real findings, all fixed except one (deliberately mitigated, not eliminated — see below):

- [x] `/dashboard/summary`'s no-`date` fallback used the UTC calendar date, not IST — the same class of bug already fixed everywhere else, reintroduced here. Fixed with `todayInAppTimezone()`.
- [x] Changing a user's email to one already in use 500'd with a raw Prisma error instead of a clean one. Fixed.
- [x] No protection against locking every Admin out (disabling the last admin, or reassigning their role away). Fixed server-side — see `docs/decisions.md`.
- [x] ENTRY/EXIT buttons had no in-flight guard — a double-tap on a slow connection could create a real duplicate record. Fixed (disabled + spinner while a request is in flight).
- [x] Employee search failures were indistinguishable from "no such employee" (silently rendered as an empty result). Fixed — explicit error message shown instead.
- [x] `employeeCode` uniqueness was case-sensitive while every search is case-insensitive, and `email` had no uniqueness constraint at all. Fixed with case-insensitive checks on create/update.
- [x] `StorageService` failed deep inside the AWS SDK with an opaque error when `STORAGE_*` env vars were missing. Fixed with a fail-fast check matching `EmailService`'s existing pattern.
- [x] Corrections/missing-record modal crashed into a raw `"Invalid time value"` error if the time field was cleared before saving. Fixed with input validation.
- [x] `navigator.onLine` alone can't detect "server unreachable while the network link is fine" — closed the same gap already fixed for auth, now on the recording screen too, via `GET /api/health` + periodic polling.
- [x] Offline sync only retried on browser online/offline events, missing "link never dropped, server was briefly down" — added a timer-based retry, plus a `beforeunload` warning when movements are still pending sync.
- **Not eliminated, only mitigated**: the offline movement queue lives only in the guard's browser (IndexedDB) with no server-side trace — clearing site data, uninstalling the PWA, or switching devices before syncing still loses queued movements permanently and silently. The timer retry and `beforeunload` warning above shrink the risk window; a full fix would need a different architecture (e.g. a server-acknowledged offline channel, or an SMS/USSD fallback). Flagged as a follow-up, not yet scheduled.

See `CHANGELOG.md`'s 2026-09-21 entry for the complete file-level diff list, and `docs/decisions.md` for the reasoning behind each fix.

## 2026-09-21 (cont.) — UI/UX pass

A full pass over every user-facing interaction, requested explicitly ("the ux is the most important thing... easy to use... no struggle"). Real, verified fixes (not just implemented blind — each was confirmed with a Puppeteer screenshot before being called done):

- [x] Header logo rendered with a blurry "shadow" edge — was a CSS mask hack faking a white version of the (real, unaltered) teal logo; replaced with the logo shown in its true color on a small white badge.
- [x] **Employees "Edit" opened its form at the top of the page**, invisible without scrolling back up — converted to a centered modal, same pattern as Corrections' edit modal.
- [x] **Editing or deactivating an employee reloaded the list from page 1**, silently discarding any "Load More" progress — now patches just that one row in local state instead of reloading. Same fix applied to Users' disable/enable.
- [x] **No success confirmation after "Add Employee"/"Add User"** — with 200+ employees sorted alphabetically, a newly added one might not even land on the reset-to-page-1 view, and the only prior feedback was the form silently clearing. Both now show an explicit success banner.
- [x] **Users page had no loading indicator at all** — missed in the loading-skeleton work below; fixed to match every other data table in the app.
- [x] No loading indicator on any data table while fetching (Dashboard, Employees, Corrections, Audit Log, Employee Details, Users) — added a shared shimmer skeleton (`TableSkeleton`).
- [x] No password visibility toggle anywhere (Login, Reset Password, Add User) — added a shared `PasswordInput` component.
- [x] No way to clear a search box except deleting text manually (SecurityHome, Dashboard, Corrections, Employees) — added a clear (×) button, matching the affordance the selected-employee chip already had.
- [x] `.table-action-btn` (Edit/Deactivate/Correct) was a ~28px touch target, tight on a tablet — bumped to 36px+.
- [x] No visual required-field marker on any form — added `*` markers everywhere.
- [x] Form inputs were 15px, under the 16px iOS Safari needs to not auto-zoom the page on focus — bumped to 16px app-wide.

See `CHANGELOG.md`'s 2026-09-21 (cont. 2)/(cont. 3) entries for the complete list, and `docs/developer-guide.md`'s "Adding a new frontend page" section for the conventions this established going forward.

## Suggested next step

The app is live end to end — frontend (Vercel), backend (Render), database (Supabase), email (Microsoft Graph) — with all three roles verified working, the full "Email Details" flow confirmed in production (including the 2026-09-21 Puppeteer/Render fix), and both a mobile/desktop responsive audit and a full crash/bug/offline-edge-case audit completed with every real finding fixed except the one offline-queue limitation noted above. Nothing is currently blocked on external input except the two items below. Highest-leverage next steps, in order: (1) run the Exchange Online application access policy restricting the Azure app to one mailbox (currently unrestricted — see "Blocked" section above); (2) swap `MAIL_FROM_ADDRESS`/`SECURITY_EMAIL` to the real `security@adage-automation.com` mailbox once it exists, replacing the current `shivani.naik@` stand-in; (3) set up the recommended external uptime monitor (UptimeRobot or similar) on `/api/health` if not already done, since the GitHub Actions pinger alone has the 60-day-inactivity blind spot noted above; (4) decide whether the offline-queue's remaining data-loss risk (above) is worth a dedicated follow-up.
