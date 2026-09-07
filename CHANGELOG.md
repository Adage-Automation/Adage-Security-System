# Changelog

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
