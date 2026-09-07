# Roadmap / Task List

Status as of 2026-09-04 (after a full audit pass — see [Audit findings](#audit-findings-2026-09-04) below). Grouped by area, roughly in priority order within each group.

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
- [x] Reports: Puppeteer HTML→PNG/PDF template, on-demand-only email send via SMTP (switched from Resend to SMTP through Adage's existing Microsoft 365 tenant on 2026-09-07 — see [decisions.md](./decisions.md)), persisted-to-storage attachment, email_logs
- [x] Users/Roles/Permissions/Settings/Audit-logs admin modules
- [x] Frontend: Login, SecurityHome (search→select→ENTRY/EXIT, duplicate-confirm dialog, offline IndexedDB queue with pending-sync UI), Dashboard (filters + summary + responsive table/cards), EmployeeDetails (view + on-demand email with resend confirmation — download buttons removed 2026-09-03 by request), Employees/Users/Settings admin pages, **Corrections** (`/corrections`) and **Audit Log viewer** (`/audit-log`)
- [x] **CSV employee import** (spec §41) — `backend/scripts/import-employees.ts`, run via `npm run import:employees -- <path-to-csv>`. Validates every row (required fields, email format, duplicate codes) before writing, upserts by employee code. Used 2026-09-03 to import the first 6 real employees.
- [x] Real Adage branding — logo wired in everywhere (header, login, PWA icons, report template); exact brand teal (`#0d828b`) sampled from the logo file. See [branding-and-data-needed.md](./branding-and-data-needed.md) for what's still open (a square mark-only logo variant, not blocking).
- [x] PWA manifest + service worker (`vite-plugin-pwa`)
- [x] Both backend and frontend build cleanly (verified via `npm run build`)
- [x] Full documentation set (this folder + root README/CHANGELOG)
- [x] Database provider decided and live: Supabase Postgres, Mumbai (ap-south-1) — see [decisions.md](./decisions.md#database-provider-supabase-mumbai)
- [x] Real `backend/.env` created (never committed) with actual `DATABASE_URL` and a generated `SESSION_SECRET`; email/storage credentials still pending (see `docs/email-provider-options.md`)

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

**Deliberately not fixed this session** (tracked below instead, since they're larger or lower-urgency):
- Puppeteer launches a brand-new headless Chromium process per report generation — fine at today's volume, will misbehave under concurrent load. See "Known simplifications."
- A guard who loses connectivity *and* has the app killed/reloaded before it reconnects cannot reach the recording screen until connectivity returns (the offline queue only helps mid-session, not across a restart during an outage). See "Known simplifications."
- Accessibility gaps (no focus trap/Escape-to-close on modals, missing aria-labels) — tracked under "Not started — quality" below, unchanged.
- Minor polish items (loading-vs-empty flash on first render, no AbortController/timeout on fetches, `SettingsController` accepting arbitrary keys, unvalidated numeric route params falling through to raw 500s, audit log rows duplicating full employee PII) — noted here, not yet actioned.

## Blocked — waiting on external input

These are code-complete but can't be verified end-to-end until someone outside this session provides the credentials. Nothing else is blocking them.

- [ ] **Email sending (SMTP)** — code fully switched from Resend to SMTP via `nodemailer` on 2026-09-07 (`backend/src/email/email.service.ts`), targeting Adage's existing Microsoft 365 tenant for `adage-automation.com` (confirmed via MX records — no new vendor needed). **Waiting on**: whoever administers Microsoft 365 to (1) confirm/create the `security@adage-automation.com` mailbox, (2) enable Authenticated SMTP for it, (3) hand back the mailbox password or an app password. Full instructions already handed off: `docs/email-m365-admin-handoff.md`. Once received, the only step left is filling in `SMTP_PASS` in `backend/.env` (host/port/user are already set) and sending one real test email.
- [ ] **Persisted report storage (Supabase Storage)** — code already built (`backend/src/reports/storage.service.ts`), speaks the generic S3 API. **Waiting on**: creating a private bucket in the same Supabase project as the database and generating S3-compatible access keys (Project Settings → Storage → S3 Connection — see `docs/deployment.md#setting-up-supabase`), then filling in `STORAGE_ENDPOINT`/`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` in `backend/.env` (currently blank). Without this, the "Email Details" flow will fail at the upload-to-storage step even once SMTP works — both are needed together for a real end-to-end send.

## Not started — infrastructure

- [ ] CI pipeline (lint + build + test on every push/PR) — none exists yet
- [ ] Deployment to any environment — see `docs/deployment.md` for the target architecture; nothing is deployed yet
- [ ] Verify Puppeteer's Chromium dependency works in the actual deploy target before relying on it in production

## Not started — features

- [ ] **Forgot password** — spec requires it; current login page has a non-functional placeholder link. Needs a reset-token flow (email a link, expire it, verify server-side) — this is now more relevant than early on since "on-demand" reset by an Admin is the only path today.

## Not started — quality

- [ ] Automated tests — `docs/testing.md` defines the full required checklist (auth, employees, movements, dashboard, email, authorization); zero test files currently exist, though `npm test` / `npm run test:e2e` scripts are wired up and ready.
- [ ] Load/perf testing against a realistic employee count (spec calls out "large employee databases" as a case to handle).
- [ ] Accessibility pass: no focus trap or Escape-to-close on any modal (confirm-duplicate dialog, Corrections edit modal), missing aria-labels in places, color-contrast not formally checked against the teal palette.
- [ ] Loading-vs-empty-state flash: Dashboard/EmployeeDetails/Corrections all initialize their record list as `[]`, so the "No records found" empty state renders briefly before the first fetch resolves, on every navigation.
- [ ] No request timeout: `frontend/src/api/client.ts` has no `AbortController`/timeout on any fetch — a genuinely hung request leaves a "Sending…"/"Saving…" button stuck indefinitely with no way out but reloading.

## Known simplifications worth revisiting

- **Timezone correctness (backend)**: day-boundary queries (`dayRange` in `movements.service.ts`) rely on the server process's OS timezone being set to `Asia/Kolkata`, rather than doing explicit UTC↔IST conversion with `date-fns-tz` (which is already a dependency but unused so far). Fine as long as deploys always set `TZ=Asia/Kolkata`; worth hardening if the backend ever runs in a different-timezone environment. (Note: the equivalent *frontend* bug — default dates computed in UTC instead of local time — was found and fixed 2026-09-04; this bullet is about the backend's day-boundary math specifically, which is a different, still-open simplification.)
- **Offline sync conflict handling is still fairly minimal**: a queued movement that comes back `requiresConfirmation` on sync is now auto-confirmed rather than getting stuck forever (fixed 2026-09-04), but there's still no explicit handling for e.g. two queued movements for the same employee racing against a movement recorded from another device in between. Acceptable for a single-guard-per-gate deployment; revisit if multiple guards can record for the same gate concurrently while offline.
- **Offline + app restart mid-outage = temporary lockout**: if the PWA is closed/reloaded while offline, `/auth/me` fails and `ProtectedRoute` redirects to `/login` — but login itself needs network. A guard whose app gets killed (common under mobile memory pressure) during an outage can't reach the recording screen again until connectivity returns, even though the offline queue exists specifically for this scenario. Would need either a "last known authenticated" grace state or a service-worker-level auth cache to fully close.
- **A new headless Chromium process launches per report generation** (`ReportGeneratorService.renderWithPuppeteer`) rather than reusing a pooled browser instance. Each launch costs real time and memory; fine at today's volume, will degrade under concurrent "Email Details" clicks or a burst of downloads, and is a plausible OOM risk on a small hosting instance. Fix: launch once at module init, reuse across requests, open/close only pages per call.
- **Reports controller's `email` endpoint uses `@Post` with query params** rather than a request body — consistent with the rest of the reports endpoints (`image`/`pdf` also use query params for `employeeId`/`date`), but worth a second look if this API is ever consumed by something other than the bundled frontend.
- **`SettingsController.set` accepts any arbitrary key** with no whitelist to the known setting keys — admin-only, low risk, but allows silent junk rows via typos.
- **Several controllers convert route params with `Number(id)` instead of `ParseIntPipe`** — a malformed ID reaches Prisma and surfaces as a generic 500 instead of a clean 400. Same root cause class as the DTO validation gaps fixed 2026-09-04, just via route params instead of request bodies.

## Suggested next step

The database is live, the core movement-recording loop and the full RBAC split are verified end to end, and a full audit pass has been completed with all blocking/real-gap findings fixed. Email sending is now code-complete (SMTP via Adage's Microsoft 365 tenant) but **blocked on external input** — see "Blocked — waiting on external input" above for exactly what's needed and from whom. Once those two items land, the highest-leverage next steps are, in order: (1) send one real "Email Details" end to end against an actual inbox to confirm the SMTP + storage path works together, not just in isolation; (2) write the automated test suite against `docs/testing.md`'s checklist, now that there's a real database and a settled permission model to test against; (3) pool the Puppeteer browser instance before this goes anywhere near real concurrent usage.
