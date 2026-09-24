# Changelog

## 2026-09-24 — Migration backfill for the manually-dropped employee columns

- **Added `20260924100000_drop_employee_metadata_columns`**, a follow-up Prisma migration recording (for migration-history purposes only) the `Employee.phone`/`department`/`designation` column removal that was done directly against the live Supabase database on 2026-09-22, outside Prisma's own migration flow. Against the live database this is a genuine no-op (`DROP COLUMN IF EXISTS` — the columns were already gone; verified `/employees` and `/employees/search` before and after, both clean). Its only purpose is keeping a *future* from-scratch database build honest — without it, replaying the full migration history would still recreate these columns via the original `20260903103752_init`. See `docs/decisions.md`.

## 2026-09-23 — Crash-risk audit: guard three more unguarded storage/transaction calls

A follow-up audit specifically targeting code changed in the last few sessions, run in parallel across backend and frontend. One claimed finding (a `Promise.race` losing branch supposedly crashing the whole process via an unhandled rejection, in `report-generator.service.ts`'s render timeout) was checked empirically with a standalone Node script and ruled out as a false positive — `Promise.race` attaches a rejection handler to every promise it's given internally, so a losing branch settling late never goes unhandled. No fix needed there. Three real, previously-missed issues were found and fixed:

- **`frontend/src/auth/AuthContext.tsx`'s `cacheUser()` had no try/catch around `localStorage.setItem`**, unlike every other storage write added in recent sessions (`clockOffset.ts`, `employeeCache.ts`, `WelcomeBanner.tsx`). On a device where `localStorage` throws (private-browsing mode, quota exceeded, disabled by policy), this could surface a false "Unable to sign in" error on login despite the server having authenticated successfully, or silently discard a valid just-fetched session on page load (the thrown error wasn't an `ApiError`, so the auth-cache-fallback logic treated it as "couldn't reach the server" and fell back to a — now also failed to write — cached user, i.e. `null`). Fixed with the same try/catch pattern already used everywhere else.
- **`frontend/src/pages/SecurityHome.tsx`'s `syncPending()` had an unguarded `listPendingMovements()` call.** Its sibling `refreshPendingCount` got this exact guard in the 2026-09-22 audit, but `syncPending` was missed. Since `syncPending` is invoked via `void syncPending()` from both a mount effect and a repeating 20s interval (while anything is pending), an IndexedDB failure here would have produced a repeating unhandled rejection every 20 seconds, with sync silently never running and no feedback to the guard. Fixed.
- **`backend/src/movements/movements.service.ts`'s per-employee advisory-lock transaction used Prisma's defaults** (5s transaction timeout, 2s max-wait). Under a burst of concurrent taps for the *same* employee — several devices' offline queues syncing at once after a shared outage, all queued for one person — requests serialize behind the lock, and if the queue depth × per-transaction time exceeded 5s, later requests would throw a generic transaction-timeout error (caught cleanly by `AllExceptionsFilter`, so no process crash, but a confusing "Unable to save record" the guard has to manually re-tap). Widened to `{ maxWait: 10_000, timeout: 20_000 }`.

## 2026-09-22 (cont. 5) — Report-generator resilience + priority UX pass (welcome banner, clearer offline status, empty states, duplicate-confirm context, Settings save-all, Audit Log filters)

Follow-up to a crash-risk audit and a UX backlog review — implemented the items explicitly picked as worth doing now (Puppeteer single-browser risk, plus 6 of the 7 prioritized UX items; the broad responsive/contrast pass was scoped down to spot-checking the pages touched here, not a full site-wide redesign).

### Fixed

- **Puppeteer's pooled report-generator browser had no recovery path for a wedged (not fully crashed) instance.** The existing `'disconnected'` handler only caught a browser that actually crashed — a hung renderer or a `page.setContent` that never settles would leave every future report request hanging behind the same stuck instance indefinitely, with no timeout and no way to notice. Fixed: a 30s render timeout via `Promise.race`, and `newPage()` failing (not just disconnecting) now triggers one retry with a freshly launched browser. Only a timeout is treated as "this browser may be unhealthy" — an ordinary render error (bad input, a template bug) no longer force-relaunches a perfectly fine pooled browser. Verified with a dedicated test suite (`report-generator.service.spec.ts`, mocked Puppeteer): retries once on `newPage()` failure, discards the pooled browser after a real timeout, and does *not* discard it for an unrelated render error.

### Added

- **"Welcome back, [name]" banner right after login**, with a one-line role-specific next action (Security: search to record a movement; HR: filter/export today's activity; Admin: record a movement or use the admin menu). Shown once via a `sessionStorage` flag set at login and cleared on read, so it never reappears on refresh or back-navigation. New `frontend/src/components/WelcomeBanner.tsx`.
- **Clearer offline/sync wording on the Security recording screen** — "Offline mode — you can still search employees from the last saved list. Movements will be saved once connection returns.", "Queued: N movements pending sync — will be sent automatically once connection returns.", explicit per-tap "Queued: Entry — [name]. Will sync automatically once connection returns."
- **Duplicate-confirmation dialog now shows real context instead of just a bare type.** `POST /movements`'s `requiresConfirmation` response now includes `lastMovementAt`; the dialog shows the employee's name, when the conflicting movement was last recorded ("last recorded: ENTRY at 4:01 PM"), and an explicit "this would record ENTRY twice in a row" explanation before the guard confirms. Button relabeled "Confirm anyway" for clarity. Verified end-to-end with a real duplicate-tap sequence.
- **Better empty-state guidance on Dashboard and Audit Log** — distinguishes "no matches for this filter" (with a hint to try a different value, and a Clear-all-filters button) from a genuinely empty table ("No movements recorded for this date" / "No audit log entries yet").
- **Audit Log: date-range filter (`from`/`to`) + keyword search**, debounced, searching action name, entity type, performing user's name, and IP address. Always newest-first (already the default; not new, but confirmed). New `GET /audit-logs` query params `from`/`to`/`q`; `AuditLogService.list` covered by 5 new unit tests.
- **Settings rebuilt as a single "Save all changes" form**, replacing four separate per-field Save buttons — matches every other form in the app. Adds an "Unsaved changes" indicator, per-field required/format validation before saving (with inline error text), and a centered save confirmation. Only fields that actually changed are sent to the server.

See `docs/decisions.md`, `docs/api-reference.md`, `docs/architecture.md`, `docs/testing.md` for the reasoning and updated contracts behind each of these.

## 2026-09-22 (cont. 4) — Fix: concurrent-device duplicate race, offline search, silent offline-storage failures

### Fixed

- **Two guards on two different devices tapping for the same employee within the same instant could both create a movement with no duplicate warning shown to either.** `MovementsService.createMovement` read "last movement for this employee" and wrote the new record as two separate steps with no lock between them — two near-simultaneous requests could both read the same "last movement" before either committed, and both slip past the duplicate-type confirmation check. Fixed by wrapping the check-then-write in a transaction that takes a Postgres advisory lock (`pg_advisory_xact_lock`) scoped to that employee's id — this serializes concurrent requests for the *same* employee only (any other employee's tap proceeds immediately, uncontended) and releases automatically when the transaction ends. The guard-facing behavior is unchanged: the second tap still gets the "already marked in/out" confirmation and can record it anyway if confirmed. Verified against the real database (not just mocked) with two concurrent connections requesting the same lock key: the second visibly waited ~1s for the first to finish, while two different employees' locks ran fully concurrently.
- **A guard could not search for a new (not-already-selected) employee while genuinely offline.** `/employees/search` is deliberately `NetworkOnly` in the service worker, and there was no local copy of the roster at all — a guard who opened the app already offline, or went offline before picking someone new, had no way to find them. Fixed: new `GET /employees/offline-cache` (full active roster, lightweight fields) is fetched by the frontend on load and every 5 minutes while online, cached in `localStorage` (`frontend/src/offline/employeeCache.ts`), and used as the search fallback whenever the app is offline (or a live search call fails). Verified end-to-end: cached 206 employees while online, went fully offline, searched, and got correct matching results with no error banner.
- **Two unhandled-promise-rejection paths in the offline queue.** `enqueueMovement()` (IndexedDB) can reject — private-browsing restrictions, storage quota, a locked-down device profile — and both call sites in `SecurityHome.tsx` awaited it with nothing catching a failure: the guard's tap would silently do nothing, no banner at all, at the exact moment (already offline) they'd most need feedback. Now wrapped in `try/catch` with a visible error banner. `refreshPendingCount` (also IndexedDB) got the same treatment since it's called from several places, some of them fire-and-forget.

## 2026-09-22 (cont. 3) — Fix: offline-recorded movements now keep their real tap time

### Fixed

- **A movement recorded while offline was written to the database with the time it happened to *sync*, not the time the guard actually tapped ENTRY/EXIT.** Found while discussing what happens when several offline taps sync at once: `MovementsService.createMovement` always used `new Date()` at request-processing time, and the offline queue's locally-captured real tap time (`queuedAt`) was never sent to the server. A guard offline for a couple of hours would have every queued tap land bunched within seconds of each other at the sync moment. Fixed: `POST /movements` now accepts an optional `clientMovementAt`, sent only by the offline-queue sync path, and uses it (flagging the record `recordedOffline: true`) only when it's within a plausible window (≤7 days in the past, ≤5min in the future) — otherwise falls back to the server clock exactly as before. Live/online taps are completely unaffected. New `recorded_offline` column (migration `20260922120000_add_recorded_offline_flag`) surfaced as a small "offline" badge next to the time in Dashboard, EmployeeDetails, and Corrections. See `docs/decisions.md`.
- Verified end-to-end with Puppeteer + simulated network offline: tapped ENTRY offline, waited ~7s, reconnected — the synced record's `movementAt` landed within 515ms of the real tap time (not the ~6.4s-later reconnect time), `recordedOffline: true`.

### Added

- **`clientMovementAt`'s plausibility window raised from 48h to 7 days** — these are company-managed phones, not open personal devices, so the backdating-spoofing risk the bound guards against is lower than the original assumption; 48h was too tight for a real extended-leave/broken-phone case. See `docs/decisions.md`.
- **New `frontend/src/offline/clockOffset.ts`: corrects a wrong device clock in software, without relying on phone settings.** Whenever the app successfully reaches the server (piggybacking on the existing 20s health-check poll), it compares the server's reported time against the device's own clock and stores the difference. The offline queue (`movementQueue.ts`'s `enqueueMovement`) now captures `queuedAt` using this corrected clock instead of the raw device clock, so a device with a wrong system time no longer produces a wrong `clientMovementAt`. Verified end-to-end: simulated a device clock running 3 hours fast, recorded an offline tap, and the synced record's `movementAt` landed within 335ms of the true tap time (not ~3 hours off).

## 2026-09-22 (cont. 2) — Login by username or email; faster reset after recording a movement

### Added

- **Login now accepts either username or email in the same field** (`Username or Email` on the login form) — email match is case-insensitive. Requested by the user. Backend: `AuthService.validateUser` now matches on `username` OR case-insensitive `email` instead of `username` only.

### Changed

- **Cut the delay between recording an ENTRY/EXIT and the search box reappearing for the next employee from 1800ms to 800ms** (`AUTO_RESET_DELAY_MS` in `SecurityHome.tsx`) — reported by the user as feeling slow when working through several people quickly at the gate. The success/pending-sync confirmation banner isn't cleared by this timer (only picking the next employee does), so the confirmation stays visible above the search box rather than being lost.

## 2026-09-22 (cont. 1) — Dashboard: employee names are now clickable, linking straight to their day view

### Added

- **Employee names in the Dashboard's movement records table/cards are now links** to `/employee-details` for that employee and the currently selected date — same destination as the existing "View Employee Day" button, just reachable directly from the row instead of requiring a separate employee-filter step first. Requested by the user. Verified via screenshot (both the table row link and the resulting Employee Movement Details page).

## 2026-09-22 — Fix keep-alive workflow's timeout being shorter than Render's actual cold-start time

### Fixed

- **`.github/workflows/keep-alive.yml` had failed on every scheduled run since it started actually hitting a cold backend** (3 consecutive failures, reported by the user). Its first run happened to pass because the backend was already warm from manual testing; every run after that failed. Root cause: `curl --max-time 25` against a Render free-tier instance that was genuinely asleep — timed a real cold start at 33s, over the 25s budget. Bumped to `--max-time 100`.

## 2026-09-21 (cont. 6) — Employee search dropdown now closes on outside click; no longer opens itself on page load

### Fixed

- **SecurityHome's search box auto-focused on page load, so its browse dropdown opened by itself before any click — and none of the three employee search boxes (SecurityHome, Dashboard, Corrections) could be dismissed by clicking elsewhere on the page.** Reported directly by the user: the dropdown stayed open and covered the rest of the screen, including the Dashboard button, until an employee was picked. Removed `autoFocus`; added a `dropdownOpen` state per page (independent of the cached results list) plus a click-outside listener that closes it. Verified via screenshot and by confirming the Dashboard link becomes clickable again after clicking outside the dropdown.

## 2026-09-21 (cont. 5) — Employee search dropdown now shows a browse list on focus, not just after typing

### Fixed

- **Every employee search box (SecurityHome, Dashboard's employee filter, Corrections) showed nothing until you started typing** — reported directly by the user as looking unresponsive/broken. `EmployeesService.search()`/`searchIncludingInactive()` now return the first 10 employees alphabetically for a blank query instead of `[]`; the frontend fetches this immediately on input focus (in addition to the existing debounced fetch while typing), so tapping an empty search box shows a usable list right away. Verified via screenshot: SecurityHome's `autoFocus` search box shows the browse list the instant the page loads; clicking Dashboard's empty "All Employees" field shows it immediately too.

## 2026-09-21 (cont. 4) — More UX fixes (pagination-preserving edits, success confirmations), docs consolidation, file audit

### Fixed

- **Editing or deactivating/reactivating an employee reloaded the whole list from page 1**, silently discarding "Load More" progress — an admin who scrolled/loaded to row 150 to fix one record would lose their place entirely. `Employees.tsx`'s `saveEdit`/`toggleActive` now patch the one affected row in local state using the API's response, instead of reloading. Same fix applied to `Users.tsx`'s disable/enable.
- **No success confirmation after "Add Employee" or "Add User"** — the form just cleared silently; with 200+ employees sorted alphabetically, a newly added one might not even appear in the post-reload page-1 view, so there was no reassurance it actually worked. Both now show an explicit green confirmation banner.
- **`Users.tsx` had no loading indicator at all** — missed in the earlier loading-skeleton pass; added, matching every other data table.

### Changed — docs

- **Merged `docs/email-provider-options.md` into `docs/decisions.md`** — its content (a provider comparison table) was already substantially duplicated by `decisions.md`'s two email-provider decision entries; folded the table in there and deleted the standalone file, updating the three docs that referenced it (`branding-and-data-needed.md`, `roadmap.md`, `docs/README.md`). Net: 17 docs → 16.
- Documented the new UI/UX conventions from this and the prior UX pass in `docs/developer-guide.md` ("Adding a new frontend page"): reuse `TableSkeleton`/`PasswordInput`, edit forms triggered from a table row must be a modal, patch-not-reload after row-level edits, required-field markers, success confirmations on create actions.
- Added a `docs/roadmap.md` section summarizing the full 2026-09-21 UI/UX pass, and two manual-QA checklist items to `docs/testing.md`.

### Audited, no action needed

- Full sweep of every project file (excluding `node_modules`/`.git`/`dist`): nothing unnecessary or dead found. Two files that look like candidates for removal on first glance are both legitimate: `backend/src/reports/assets/adage-logo.png` is a separate, necessary copy of the logo embedded server-side into generated PNG/PDF reports (distinct from `frontend/public/logo.png`, which the browser bundle can't reach); `backend/test/app.e2e-spec.ts` is a real, working e2e suite (skipped unless `E2E_TEST_DATABASE_URL` is set), not a stale scaffold. `*.tsbuildinfo` and `.claude/scheduled_tasks.lock` are local-only, already-gitignored/untracked build-cache and tooling artifacts — no cleanup needed.

## 2026-09-21 (cont. 3) — Employee edit form moved into a modal

### Fixed

- **"Edit" on the Employees admin list opened the edit form at the top of the page**, invisible without scrolling back up — worst once the roster needed "Load More" and an admin was editing a row far down the list, with no indication where their typing was even going. Converted to a centered modal dialog (`Employees.tsx`) matching the pattern already used by Corrections.tsx and the ENTRY/EXIT duplicate-confirm dialog — appears directly over the clicked row regardless of scroll position, first field auto-focused, same focus-trap/Escape-to-close behavior as the other modals. Verified via screenshot: scrolled to the 44th row, clicked Edit, modal opened centered with the correct employee's data pre-filled.

## 2026-09-21 (cont. 2) — Header logo fix + UI/UX pass (loading states, password visibility, search clear, touch targets, required-field markers)

### Fixed

- **Header logo had a soft "shadow"/blurred edge around the wordmark.** The logo is teal and the header background is dark teal, so it was being rendered white via a CSS mask trick — masking a PNG's anti-aliased alpha edges blurs/fringes at this small a size. Replaced with a small white badge showing the logo in its real, unaltered color (`.logo-badge` in `global.css`, `Header.tsx`) — same technique the login card already used successfully. Verified via screenshot: crisp on both desktop and 390px mobile, no artifacts.

### Added — UI/UX pass

- **Loading skeletons** (`frontend/src/components/TableSkeleton.tsx`) on every data table that previously showed nothing during its initial fetch — Dashboard, Employees, Corrections, Audit Log, Employee Details. Verified via a throttled-network screenshot that it actually renders mid-load, not just in theory.
- **Password visibility toggle** (`frontend/src/components/PasswordInput.tsx`, new `IconEye`/`IconEyeOff`) on every password field: Login, Reset Password (both fields), and the Users "Add User" form.
- **Clear (×) button inside every search input** — SecurityHome, Dashboard's employee filter, Corrections' employee search, and the Employees admin list — previously only the selected-employee chip had a clear affordance.
- **Larger touch target on `.table-action-btn`** (Edit/Deactivate/Reactivate/Correct buttons) — was ~28px tall, now 36px+, comfortable on a tablet/touchscreen.
- **Required-field markers** (`*`) on every required form field across Login, Reset Password, Users, and Employees (add + edit forms), and Corrections' time field.
- **16px minimum font-size on all `.field` inputs/selects** (was 15px) — under 16px, iOS Safari auto-zooms the whole page on focus, a jarring surprise on a form filled out on a phone.
- **`autoFocus` on Login's username field and Reset Password's first field** — one less tap/click before typing.

## 2026-09-21 (cont.) — Docs sync: deployment reality, new /health endpoint, all 2026-09-21 audit fixes documented

Full documentation pass, requested explicitly ("check all the docs and update them ... keep the docs properly inlined with the code we have now"). No code changes — docs only.

### Fixed (stale docs)

- **`docs/deployment.md` and `docs/roadmap.md` both still said "nothing is deployed yet"** and listed deployment as not-started, despite the app having been live on Vercel (frontend) + Render (backend) + Supabase (database) since 2026-09-11. Rewrote both to state the actual live setup, added a new "Keeping it alive" section covering Render's sleep + Supabase's auto-pause and the `/api/health` + keep-alive-workflow mitigation, and updated the Puppeteer pre-deployment checklist item with the real Render `postinstall`-gets-skipped gotcha found and fixed live today.
- **`docs/api-reference.md`** — added the new `GET /health` endpoint; documented the new `409`/`400` responses on `PUT /employees/:id`/`PUT /users/:id`/`PATCH /users/:id/disable` from today's uniqueness/admin-lockout fixes; corrected the dashboard summary's default-date note to mention the IST fix.
- **`docs/decisions.md`** — added entries for all of today's real decisions: last-admin lockout protection, case-insensitive employeeCode/email uniqueness, real server-reachability detection, offline-sync timer retry + `beforeunload` warning, the double-tap guard, the Render/Puppeteer build-command fix, and the health-endpoint/keep-alive design.
- **`docs/security.md`, `docs/database-schema.md`, `docs/architecture.md`, `docs/developer-guide.md`, `docs/testing.md`, `README.md`, `docs/branding-and-data-needed.md`** — updated for the new `health` module, the admin-lockout/uniqueness/reachability fixes, the `todayInAppTimezone()` helper, and (branding doc) marking domain/deployment as live rather than "when ready to go live."

## 2026-09-21 — Full code audit fixes: admin-lockout guard, duplicate-tap guard, IST date bug, uniqueness checks, reachability detection, storage fail-fast

### Fixed

- **Backend `/dashboard/summary` returned yesterday's data for the first 5.5 hours of every IST day** when called with no `date` param — its own default-date fallback still used `new Date().toISOString().slice(0, 10)` (UTC calendar date), the exact bug already fixed in the frontend's `todayIso()`. Added `todayInAppTimezone()` (`backend/src/common/utils/day-range.ts`) and switched the fallback to it.
- **Changing a user's email to one already in use 500'd** with a raw Prisma P2002 instead of a clean error. `UsersService.update()` now checks for a case-sensitive clash first and throws a proper 409 ("That email address is already in use by another user.").
- **No protection against locking every Admin out.** `UsersService` now blocks disabling the last remaining active user who holds `MANAGE_USERS`, and blocks reassigning that user's role away from one that holds it, either way returning a clean 400 instead of allowing a silent total lockout recoverable only via direct DB access.
- **Duplicate ENTRY/EXIT records possible on a slow connection** — the guard's big ENTRY/EXIT buttons had no in-flight guard, so a double-tap could fire two concurrent requests each with their own idempotency key. `SecurityHome.tsx` now tracks a `submitting` flag, disables both buttons (and the confirm-dialog's buttons) while a request is in flight, and shows a spinner.
- **Employee search failures were indistinguishable from "no such employee"** — a network blip during search silently rendered an empty result list. `SecurityHome.tsx` now shows an explicit "Search failed — check your connection and try again." message instead of a false-empty state.
- **`employeeCode` uniqueness was case-sensitive while every search is case-insensitive**, and employee `email` had no uniqueness constraint at all. `EmployeesService` now checks both case-insensitively on create/update and returns a clear 409 (naming the existing employee, for the email case) instead of allowing silent collisions.
- **`StorageService` built an S3 client with empty-string defaults** when `STORAGE_BUCKET`/`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` were unset, failing deep inside the AWS SDK with an opaque error. Added a `requireConfig()` fail-fast check matching `EmailService`'s existing pattern, and made the S3 client itself lazy (only constructed once config is confirmed present).
- **Correction/missing-record modal crashed into a raw "Invalid time value" error** if the native time field was cleared before saving — `edit.time`'s unguarded `Number()` parse produced `NaN`, which flowed into `setHours(NaN, ...)` and then threw out of `.toISOString()`. `Corrections.tsx` now validates the parsed hours/minutes before use and shows a friendly message instead.

### Added

- **`GET /api/health`** (`backend/src/health/health.controller.ts`) — public, unauthenticated, does a real `SELECT 1` round trip. Serves two purposes: (1) the frontend's new real server-reachability check (below), and (2) an external keep-alive target — see `.github/workflows/keep-alive.yml`, a scheduled GitHub Actions job pinging it every 10 minutes to stop Render's free tier from sleeping and Supabase's free tier from auto-pausing.
- **Real server-reachability detection on the recording screen** (`frontend/src/api/health.ts`, wired into `SecurityHome.tsx`) — `navigator.onLine` only reflects the network link, not whether the backend is actually reachable (dead backend, DNS hiccup, captive portal all still report "online"). The recording screen now polls `/api/health` every 20s while the link is up and shows a distinct "server unreachable" banner instead of no warning at all. Mirrors the same class of fix already made for auth (`AuthContext.tsx`'s `shouldUseCachedUser`).
- **Offline sync now retries on a timer, not just on browser online/offline events** — previously a movement queued during a transient server-side blip (not a real link drop) could sit unsynced indefinitely since no browser event would ever fire to trigger a retry. `SecurityHome.tsx` now polls every 20s while anything is pending and the connection is effectively up.
- **`beforeunload` warning when offline movements are still pending sync** — mitigates (not eliminates) the offline queue's biggest risk: it lives only in this browser's IndexedDB with no server-side trace, so clearing site data, uninstalling the PWA, or switching devices before syncing loses those movements permanently and silently. A guard is far less likely to do that if warned at the moment they'd navigate away or close the tab.

## 2026-09-11 (cont. 3) — Full mobile/desktop responsive audit, two real layout bugs fixed

### Fixed

- **Settings page's nav bar wrapped to two rows on desktop** while every other admin page's nav stayed on one — `Settings.tsx` was the only screen rendering `AdminNav` inside the narrow `.page` container (meant for single-column screens like Login/EmployeeDetails) instead of `.page-wide` (used by every other AdminNav-bearing page: Dashboard, Employees, Users, Corrections, Audit Log). Switched to `.page-wide` to match; verified all 7 nav links now render on one row at 1440px, content still well-proportioned, no change on mobile.
- **Employees/Users "Add" forms cut off the last field's text on mobile**: the submit button's wrapper `<div>` had no width/basis, so on a 390px viewport it barely still fit on the same flex row as the "Car Number"/last field, squeezing that input's placeholder to a few visible characters instead of wrapping to its own row like the rest of the form did. Added a `.form-actions` class + a mobile-only `width: 100%` rule so the button always gets its own row under 640px; desktop screenshot confirmed pixel-identical to before.

### Verified

Full pass across every route, all three roles (Security/HR/Admin), at both 390px (mobile) and 1440px (desktop): zero horizontal overflow, zero console/page errors anywhere. Also found and fixed a stale credential: the seeded `security` dev login's password had been changed to something undocumented by an earlier live forgot-password test (confirmed via its audit log — a genuine `USER_PASSWORD_RESET` on 2026-09-10) — reset back to the documented `ChangeMe123!` dev default directly in the database (not a code/migration change, so nothing to commit for this part).

## 2026-09-11 (cont. 2) — Offline-auth-cache gap closed, ARIA label associations fixed, frontend test deps self-declared

### Fixed

- **Offline auth cache didn't cover "online but server unreachable"**: `AuthContext.tsx`'s fallback to a cached logged-in user required `!navigator.onLine`, but a dead backend/DNS hiccup/dropped VPN leaves `navigator.onLine` at `true` while the request still fails — that whole case silently logged the user out instead of trusting a valid cached session. Now falls back to the cache on any failure that isn't a real `ApiError` (a server-issued 401/403). The decision is factored into an exported, unit-tested `shouldUseCachedUser()` (`frontend/src/auth/AuthContext.spec.ts`, 3 new tests). Found by the 2026-09-11 audit; see `docs/decisions.md`.
- **24 form fields across 6 pages had visually-present but programmatically unassociated `<label>`s** (Employees, Users, AuditLog, Dashboard, Corrections, Settings) — a screen reader announced these inputs/selects with no name at all. Fixed by nesting each control inside its `<label>` (implicit association); `Login.tsx`'s existing `htmlFor`/`id` fields were already correct and untouched. Added a small CSS rule to keep the label-to-control spacing identical to before. Verified visually via Puppeteer screenshots of all six pages — no layout regressions — and the new nesting was confirmed programmatically (every Employees-page input now resolves an accessible name via its enclosing label).
- **`frontend/package.json` was missing its own test dependencies** (`jest`, `ts-jest`, `@types/jest`) despite having a `test` script and spec files — it only worked because npm workspaces hoisted them from `backend`'s devDependencies. Declared them directly in `frontend/package.json` (versions matched to backend's) so `frontend`'s tests don't silently depend on another workspace's dependency tree. Found by the 2026-09-11 audit.

### Checked, found already correct

Color contrast across the app's status/muted text colors (all ≥4.6:1 against their backgrounds, passing WCAG AA); icon-only buttons (none exist — every button already pairs an icon with visible text).

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
- `department` and `designation` fields removed from the "Add Employee" form (`frontend/src/pages/Employees.tsx`) and from the employee list table — confirmed via code search they weren't referenced anywhere in search, filtering, or report generation, so they were pure unused metadata. The employee schema and CSV import format were simplified accordingly to `employee_code,employee_name,email`.
- Renamed the seeded dev "security" login account from "Rahul Sharma" to "Security User" (and its DB row updated to match) — it previously borrowed the name of a fake test employee, which was confusing now that that employee no longer exists.

### Changed

- `backend/prisma/seed.ts` no longer creates sample employees or sample movement records — only roles/permissions/settings/dev-user accounts, which are still needed for login. This prevents a future `npm run seed` re-run from silently recreating the just-deleted test data now that the database holds real employee records.

## 2026-09-03 — First real employee data

### Added

- `backend/scripts/import-employees.ts` — reusable CSV employee import (spec §41), run via `npm run import:employees -- <path-to-csv>`. Validates every row (required fields, email format, duplicate employee codes) before writing anything; upserts by employee code so re-running a corrected file is safe. This was a planned-but-not-built roadmap item, built now instead of as a one-off script since more employee batches are expected.
- `backend/data/employees-import.csv` — the source file for the first real import.
- Imported the first 6 real employees, provided by the user: Shivani R Naik (55668), Bala Dattaprasad Patwardhan (55778), Pranav P Naik (55714), Raj Ramanand Fal Dessai (55715), Sai Sanjay Kunkalienkar (55777), Adarsh Bhaskaran Chanabhat (55602). Department and designation were not tracked in the current employee schema.

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
