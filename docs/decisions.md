# Architecture Decisions Log

Dated record of decisions made while turning the original specification into a working system, and why. Newer entries at the bottom of each section reference earlier ones where relevant.

## Event log, not slots

**Decision**: `movement_records` has one row per ENTRY/EXIT event. No `morning_entry`/`lunch_exit`/`final_exit` columns.

**Why**: the spec explicitly requires unlimited entries/exits per employee per day (e.g. multiple lunch breaks, errands). A column-per-slot design caps the number of movements and can't represent an unusual day. An event log has no such limit and preserves full history naturally.

## Backend framework: NestJS

**Decision**: NestJS, not a lighter Express/Fastify setup.

**Why**: the original spec named NestJS as its recommendation. It was reconsidered mid-planning (Express/Fastify would have been leaner for this table count), but the user opted to keep NestJS as originally specified — 2026-09-03.

## Auth: session cookies, not JWT

**Decision**: `express-session` + `passport-local`, session store in Postgres via `connect-pg-simple`. Not JWT.

**Why**: guards log in on shared/mobile devices; session cookies give simpler server-side revocation (disable a user, their session is invalidated on the next request) and avoid the XSS token-theft risk of storing a JWT client-side. Chosen via explicit user decision, 2026-09-03.

**Follow-up, 2026-09-22**: login now accepts either username or email in the same form field (`AuthService.validateUser` matches `username` OR case-insensitive `email`) — requested by the user, since guards/admins shouldn't need to remember which one the account uses. Doesn't change the session-cookie mechanism above, just what identifies the account being authenticated.

## Report storage: persist emailed reports

**Decision**: PNG/PDF reports that are actually emailed are uploaded to S3-compatible storage and referenced from `email_logs.reportFileUrl`. On-demand *downloads* that are never emailed are generated fresh and not stored.

**Why**: resolves a tension in the original spec — one section suggested generating reports on demand and discarding them, while the `email_logs` table implies being able to prove exactly what was sent. Persisting only the emailed copies (not every download) balances "don't accumulate a report file per download" against "must be able to resolve an 'I never got that email' dispute." Chosen via explicit user decision, 2026-09-03.

## Duplicate movement warning: confirm before save

**Decision**: if a guard's tap would create a same-type movement back-to-back (e.g. ENTRY right after ENTRY), the server returns `requiresConfirmation: true` **without** writing a record. The client shows a confirmation popup; only a resubmission with `confirmed: true` creates the record.

**Why**: considered against a faster "always save, warn after" alternative. The confirm-first approach costs one extra tap in the rare duplicate case, but prevents an accidental duplicate record from ever existing in the first place — chosen deliberately over speed here, 2026-09-03.

## Security/CC email: single global setting

**Decision**: one `SECURITY_EMAIL` value in `settings`, used as CC on every outgoing employee-record email. Not per-shift or per-location.

**Why**: keeps v1 simple; nothing in the current organizational structure requires per-gate or per-shift email routing. Decided 2026-09-03; revisit if Adage adds multiple sites/gates with separate security desks.

**Superseded, 2026-09-25** — see "Security CC is the sending account's own email, not a global setting" below. Adage now runs multiple security units, exactly the scenario flagged above as the reason to revisit this.

## Employee search: top 10, server-side, debounced

**Decision**: `/employees/search` returns at most 10 matches, queried server-side (not a full client-side list), with the frontend debouncing input before each request.

**Why**: keeps the guard's autocomplete list short enough to fit a phone screen without scrolling (spec §7/§48), and avoids loading the entire employee table into the browser as the company grows (spec §53). Decided 2026-09-03.

## Report rendering: HTML/CSS + headless browser

**Decision**: reports are an HTML/CSS template rendered via Puppeteer to both PNG (`page.screenshot`) and PDF (`page.pdf`) from the same template. Not a canvas-drawing library, not a screenshot of the live web page.

**Why**: the spec explicitly forbids a screenshot-of-the-webpage approach and wants "a proper structured report image." A single HTML template rendered two ways keeps PNG and PDF visually identical and easy to restyle later, versus maintaining two separate drawing implementations (canvas + a separate PDF library). Decided 2026-09-03.

## Offline handling: full offline queueing

**Decision**: v1 includes offline queueing via IndexedDB and a service worker, not just a "fail and ask the guard to retry" message. A queued movement is visibly distinct from a confirmed save ("pending sync" banner) until the server confirms it. A queued movement that comes back `requiresConfirmation` during sync is flagged as a **conflict** and surfaced to the guard for intentional resolution ("Record anyway"), rather than auto-confirmed — the auto-confirm path from the 2026-09-04 audit was replaced with explicit conflict review because silently recording a duplicate without the guard knowing is worse than a short queue review.

**Why**: considered against the simpler fail-clearly-no-queue alternative. Given guards work from a gate that may have unreliable wifi, and the core promise of the app is "never falsely report success," a real offline queue was judged worth the added complexity (dedup on sync, visible pending state). Decided 2026-09-03; conflict-surface behavior updated 2026-09-10 — see `docs/roadmap.md`.

## Offline sync: preserve the real tap time, within bounds

**Decision**: `MovementsService.createMovement` accepts an optional `clientMovementAt` (ISO 8601) on `POST /movements`, sent only by the offline queue's sync path (`SecurityHome.tsx`'s `syncPending`/`resolveConflict`, using the `queuedAt` value already captured at the moment a movement is queued). It's used as `movementAt` — and the record is flagged `recordedOffline: true` — only if it falls within a plausible window: not more than 7 days in the past, not more than 5 minutes in the future (clock-skew tolerance). Outside that window, or when the field is absent (every live/online tap), the server's own clock is used exactly as before, `recordedOffline: false`. The tap is never rejected or blocked over a timestamp technicality — only the timestamp source changes.

**Why**: found while discussing an unrelated question (packaging the app as a native React Native build) — the user asked what would happen if a guard recorded several movements offline and they all synced at once. Checking the actual code showed `movementAt` was always `new Date()` at the moment the sync request is *processed*, not the real tap time, which the offline queue's `queuedAt` already captures locally but never sent. A guard queuing several taps over a multi-hour dead zone would have every one of them land in the database bunched within seconds of each other at the *sync* moment, not spread across when they actually happened — wrong data for exactly what this system exists to record (who was where, when).

The past/future bounds exist so this doesn't reopen the spoofing risk the "server is authoritative for the timestamp" rule (§20/§46) was designed to prevent: a device can't use this path to backdate a record to an arbitrary past moment to fabricate an alibi, and a wildly future timestamp (clock misconfigured, or deliberate) is rejected too. `recordedOffline` makes the exception auditable rather than silent — surfaced as a small "offline" badge next to the time in Dashboard, EmployeeDetails, and Corrections. This also fixes a secondary bug for free: the duplicate/confirmation check (`getLastMovement`, ordered by `movementAt desc`) previously ranked an offline record by when it happened to sync rather than when it actually occurred, which could misjudge which movement was really "last" if another device recorded something for the same employee during the gap. Decided and implemented 2026-09-22.

**Follow-up, same day**: the past-side bound started at 48 hours, then was raised to 7 days after discussing it with the user — these are company-managed phones, not personal/open devices, so the backdating-spoofing risk the bound guards against is lower than originally assumed, and 48h was too tight for a real "extended leave / phone sitting unused" case, which would have silently fallen back to the old wrong-timestamp behavior with no warning. 7 days still bounds the risk (can't claim "this happened months ago") while covering realistic outages on trusted hardware.

## Offline auth: short-lived local user cache

**Decision**: `AuthContext.tsx` caches the last successfully authenticated user in `localStorage` (key `adage.last-authenticated-user`) with a 12-hour expiry. If `/auth/me` fails for any reason other than the server actually rejecting the session, the cached user is restored so the recording screen and offline queue remain usable. For any real online API call, the server session is always the authority — the local cache is only used when `/auth/me` itself couldn't be answered.

**Why**: without this, a guard whose device lost connectivity but still had an active session would see the login screen on reload, losing access to the recording screen and any queued movements, even though the session is still valid server-side. The 12-hour window is short enough to prevent stale credentials persisting indefinitely (guards typically work one shift), and the cache is cleared explicitly on logout. Decided 2026-09-10.

**Updated 2026-09-11**: the original trigger condition (`!ApiError && !navigator.onLine`) was narrowed too far — see [Auth cache fallback: any non-`ApiError` failure, not `!navigator.onLine`](#auth-cache-fallback-any-non-apierror-failure-not-navigatoronline) below for why it now triggers on any non-`ApiError` failure.

## Record correction: append-only, not soft-edit

**Decision**: correcting a movement record never mutates the original row. The original is flagged `isSuperseded: true`; a new record is inserted and linked back via `correctionOfId`.

**Why**: matches the event-log philosophy (see above) — `movement_records` should always reflect exactly what was ever entered, including mistakes, with corrections layered on top rather than overwriting history. This makes it structurally impossible for a correction to silently erase what a guard originally recorded. Decided 2026-09-03.

## Inactive employees remain selectable for corrections

**Decision**: a deactivated employee is excluded from the normal Security ENTRY/EXIT search (`/employees/search`), but still selectable via `/employees/search-all`, used only by the admin correction flow.

**Why**: someone who has since left the company may still have a movement record that needs fixing. Excluding them entirely from correction would make historical data permanently uneditable once an employee is deactivated. Decided 2026-09-03.

## RBAC narrowed from v1-flat (2026-09-04)

**Decision**: replaced the original "every role gets every permission" v1 default with an explicit, differentiated mapping, by direct user request:

| Role | Permissions | Accessible screens |
|---|---|---|
| SECURITY | `RECORD_ENTRY`, `RECORD_EXIT`, `VIEW_DASHBOARD`, `VIEW_EMPLOYEE_HISTORY`, `SEND_EMAIL`, `DOWNLOAD_REPORT` | Record Movement, Dashboard (and the Employee Details/email drill-down reachable from it) |
| HR | `VIEW_DASHBOARD`, `VIEW_EMPLOYEE_HISTORY`, `SEND_EMAIL`, `DOWNLOAD_REPORT`, `MANAGE_EMPLOYEES` | Dashboard (landing page on login), Employees, Employee Details/email |
| ADMIN | every permission | everything, including Users, Corrections, Audit Log, Settings |

**Why**: user explicitly asked to restrict the admin-nav pages (Employees/Users/Corrections/Audit Log/Settings) by role — Security limited to Dashboard, HR additionally getting Employees, everything else Admin-only. `RECORD_ENTRY`/`RECORD_EXIT` were subsequently removed from HR (2026-09-10): HR has no reason to record gate movements — that's the Security guard's job. Removing these permissions also means HR's login lands directly on the Dashboard rather than the recording screen.

**How it was implemented**: this is exactly the scenario the permission-table/guard architecture was built for (see [architecture.md](./architecture.md#key-design-decisions)) — no endpoint code changed. Three things changed instead:
1. `backend/src/common/constants/permissions.ts` — `DEFAULT_ROLE_PERMISSIONS` updated (affects `npm run seed` going forward, on a fresh database).
2. The **live** `role_permissions` table was reconciled directly (a one-off script, since `seed.ts`'s `upsert` with `update: {}` never removes existing grants — re-running seed alone would not have revoked anything).
3. Frontend: `AdminNav` now conditionally renders each link based on `useAuth().hasPermission(...)`, and `ProtectedRoute` gained an optional `permission` prop that redirects to `/` if missing. Both are explicitly documented in code as UX conveniences, not the security boundary — the real enforcement is `PermissionsGuard` on every backend request, verified independently via direct API calls (403 for Security on `/users` and `/employees`, 200 on `/dashboard/summary`) before trusting the UI-level behavior.

## Database provider: Supabase (Mumbai)

**Decision**: Supabase Postgres, `ap-south-1` (Mumbai) region.

**Why**: at this scale (a handful of guards/HR/admin, a few hundred employees, light write volume), the deciding factors were regional latency and vendor consolidation rather than raw scalability. Compared against:
- **Neon** — excellent DX (instant DB branching) but no Mumbai region (nearest is Singapore), adding latency for an India-based deployment.
- **Railway** — simplest all-in-one hosting, but US/EU regions only.
- **AWS RDS** — matches on region (`ap-south-1`) and offers Multi-AZ/enterprise SLA, but more setup and ongoing ops overhead; the better choice only if Adage is already standardized on AWS infrastructure.

Supabase offers the Mumbai region, built-in daily backups + point-in-time recovery on paid tiers (satisfying spec §60 without extra setup), and **bundled S3-compatible object storage** — which can serve the `STORAGE_*` env vars already used by `StorageService` (it talks to any S3-compatible endpoint via `@aws-sdk/client-s3`), potentially replacing the separately-planned AWS S3/Cloudflare R2 bucket for persisted emailed reports. One vendor, one bill, one dashboard, for two of the app's three external dependencies. Decided 2026-09-03.

## Keyboard shortcuts: banned app-wide

**Decision**: no keyboard shortcuts for any state-changing action anywhere in the app (not just the Security screen).

**Why**: the spec bans shortcuts for ENTRY/EXIT specifically, to prevent an accidental keypress from misrecording a movement. Extending the same rule to every state-changing action (deactivate, send email, disable a user, etc.) keeps the rule simple to enforce and audit, rather than having an exception list. Decided 2026-09-03.

## Email provider: SMTP via Adage's existing Microsoft 365 tenant, not Resend

**Decision**: switched the email-sending implementation from Resend (the original build's default choice) to SMTP through Adage's own Microsoft 365 tenant for `adage-automation.com`.

**Provider comparison** (kept for reference / in case this ever needs revisiting — folded in from the now-removed `docs/email-provider-options.md`, 2026-09-21 docs consolidation, since its content was otherwise fully duplicated by this entry and the one below):

| Provider | Free tier | Pricing after free tier | Setup effort | Notes |
|---|---|---|---|---|
| **Resend** | 3,000 emails/mo, 100/day | $20/mo for 50k | Low — modern API, attachments are trivial, good docs | Newer company (est. 2023) but built specifically for developers sending from an app; was the original implementation, since replaced |
| **SendGrid** (Twilio) | 100 emails/day (free tier discontinued for new accounts as of 2025 in some regions — verify current terms) | ~$20/mo for 50k | Medium — more enterprise-y API/dashboard | Very established, good for compliance-heavy orgs; API is more verbose than Resend's |
| **Amazon SES** | No free tier by default outside AWS's own EC2 sandbox allowance; extremely cheap pay-per-use (~$0.10 per 1,000 emails) | Scales down to near-zero at this volume | High — needs AWS account, domain verification via Route53/DNS, moving out of the SES sandbox (a manual approval request) before you can send to unverified recipients | Cheapest by far at low volume, but the most setup friction; makes sense if Adage already runs on AWS |
| **Microsoft 365 tenant** (chosen; Graph API/OAuth2, not SMTP) | Whatever the existing tenant's plan includes | Usually included, no extra cost | Low-to-medium — mailbox already exists on the domain (confirmed via MX records); needs an Azure app registration with `Mail.Send` since SMTP AUTH isn't available | Rides on infrastructure Adage already pays for and depends on for real business email, so there's no separate vendor free-tier that could change terms and break this feature. Daily sending limits are higher than this app will ever need. Slightly less deliverability tooling (no dedicated bounce/complaint webhooks) than a dedicated transactional provider, but irrelevant at this app's volume. |

**Why**: the user's stated concern was durability against a vendor changing free-tier terms and silently breaking the email feature — not cost. Two options were structurally resistant to that specific failure mode: **Amazon SES** (never had a free tier at all — pure pay-as-you-go since inception, so there is no "free" status to lose) and **SMTP via an existing paid company mailbox** (not a new vendor relationship for this feature at all — it depends on infrastructure Adage already can't afford to lose for its actual business email). Between the two, SMTP won on setup effort: a direct DNS lookup of `adage-automation.com`'s MX records confirmed a Microsoft 365 tenant already exists for the domain, so there was no new AWS account, no Route53 DNS work, and no SES sandbox-removal request to go through — just enabling Authenticated SMTP on one mailbox. Building a self-hosted mail server from scratch was considered and explicitly rejected: the hard part of email delivery is sender reputation and deliverability (SPF/DKIM/DMARC, avoiding spam blacklists), not the sending code itself, and a fresh self-hosted server has zero reputation — not a reasonable tradeoff for a low-volume internal tool. Decided 2026-09-07.

**How it was implemented**: `backend/src/email/email.service.ts` rewritten from the Resend SDK to `nodemailer` over SMTP (`smtp.office365.com:587`, STARTTLS), keeping the same lazy-client-construction pattern (missing config fails only the send call, never crashes the app at boot) and the same strictly-on-demand invocation contract. New `docs/email-m365-admin-handoff.md` hands off the exact steps to whoever administers Microsoft 365 (mailbox confirmation, enabling Authenticated SMTP for that one account, an app password if MFA is on). As of this decision, still blocked on that handoff completing — see `docs/roadmap.md`'s "Blocked — waiting on external input" section.

**Superseded 2026-09-10** — see the next entry: basic-auth SMTP AUTH turned out to be retired on Adage's tenant, so this SMTP implementation was replaced before ever going live.

## Email transport: Microsoft Graph API (OAuth2), not SMTP

**Decision**: replaced the SMTP implementation above with the Microsoft Graph API, authenticating via an Azure AD app registration and the OAuth2 client-credentials grant. Still the same Microsoft 365 tenant, still no new vendor — only the transport mechanism changed.

**Why**: Adage's Microsoft 365 admin confirmed the tenant has basic-auth SMTP AUTH retired, which Microsoft has been rolling out tenant-wide for Exchange Online since 2022 for security reasons — no mailbox password or app password can authenticate an SMTP send regardless of per-mailbox settings. This wasn't something the app's code could work around: it's an authentication method Microsoft no longer accepts at the protocol level. The Graph API's `sendMail` endpoint with an application-permission OAuth2 token is Microsoft's supported path for unattended, app-only mail sending — no interactive user, no password, no MFA to route around. Considered and rejected: falling back to a delegated-permission flow (a real user's OAuth token) — unnecessary complexity and a fragile token-refresh story for a server-side background job with no signed-in user; an application-permission client-credentials token has no such expiry-refresh burden the app needs to manage beyond a simple cache.

**Security note**: an application-permission `Mail.Send` grant can send as *any* mailbox in the tenant by default — scoped down to just `security@adage-automation.com` via an Exchange Online application access policy (`New-ApplicationAccessPolicy`), documented as a required step (not optional) in the admin handoff, so a compromised client secret can't be used to send as an arbitrary employee or executive mailbox.

**How it was implemented**: `backend/src/email/email.service.ts` rewritten again — no `nodemailer`/SMTP at all now, just two `fetch` calls: one to acquire a client-credentials token from `login.microsoftonline.com` (cached in memory, refreshed ~30s before expiry), one to POST to `graph.microsoft.com/v1.0/users/{mailbox}/sendMail` with the PNG attached as base64. `nodemailer` and `@types/nodemailer` removed from `backend/package.json` as now-unused. Same lazy-config-check and strictly-on-demand invocation contract as before. `docs/email-m365-admin-handoff.md` rewritten for the new Azure app-registration steps. As of this decision, still blocked on that handoff completing — see `docs/roadmap.md`'s "Blocked — waiting on external input" section.

## Movement idempotency key

**Decision**: `POST /movements` accepts an optional `clientRequestId`, a client-generated key unique per guard tap, unchanged across retries of that same tap (including the offline queue's sync retry). The server stores it (`MovementRecord.clientRequestId`, unique) and, if a create request arrives with a key that already exists, returns the existing record instead of creating a second one.

**Why**: a guard tap can succeed on the server while the response never reaches the client (dropped connection, app killed mid-request) — the existing offline-queue retry logic would then resubmit and create a real duplicate movement record, with no way to tell it apart from a legitimate second tap. A server-generated dedup key can't work here, since the ambiguity is specifically about whether the *first* request's effect already landed; only a client-side key carried across the retry lets the server recognize "this exact attempt already succeeded." Verified live: submitting the same key twice returns one record both times, and the database has exactly one row. Decided 2026-09-09.

## Row Level Security: defense in depth

**Decision**: enabled Postgres Row Level Security on every application table in the Supabase database, with zero policies defined (migration `20260909120000_enable_row_level_security`). The runtime-created `session` table is not present when migrations run and is therefore excluded from that migration.

**Why**: prompted by Supabase's own Security Advisor flagging RLS as disabled on all 11 tables. The app's Prisma connection authenticates as the table-owner role, and Postgres always exempts a table's owner from its own RLS policies — so this change has no effect on the app's normal behavior (verified live: every workflow still worked immediately after). What it does close off: a Supabase project ships separate `anon`/`authenticated` API roles by default, intended for direct client-side (PostgREST/Supabase-JS) access — unused by this app, which only ever talks to Postgres through the NestJS backend, but present in the database regardless. With RLS off, those roles could read/write every table directly if their keys ever leaked or were reused; with RLS on and no policies, they're denied by default. A second layer of protection with no application-level cost. Decided 2026-09-09.

## Numeric input validation: `ParseIntPipe` + a custom `parseOptionalInt` helper, not `ParseIntPipe({ optional: true })`

**Decision**: every required numeric route param uses Nest's built-in `ParseIntPipe`. Every *optional* numeric query param (pagination `skip`/`take`, filter IDs) uses a small custom helper, `backend/src/common/utils/parse-optional-int.ts`, instead of Nest's own `ParseIntPipe({ optional: true })`.

**Why**: `ParseIntPipe({ optional: true })` is documented to pass a genuinely absent value straight through, only validating when a value is present. Verified against the installed `@nestjs/common` (10.4.22) that it does not do this — it throws a 400 even when the query param is completely absent, not just when malformed. This was caught immediately (all of `GET /employees`, `GET /movements`, `GET /audit-logs`, `GET /reports/email-logs` started rejecting their normal no-filter calls) and fixed the same session, before it reached the running app for real. The custom helper does exactly what was expected: `undefined`/`''` passes through as `undefined`, anything else is validated and either parsed or rejected with a clean 400. Decided 2026-09-10.

## npm workspaces: single install, single dev command

**Decision**: converted the repo to an npm workspaces monorepo (root `package.json` lists `backend`/`frontend` as workspaces, one root lockfile), replacing the earlier setup where each app had its own `node_modules` and lockfile and had to be installed/run separately.

**Why**: the original two-terminal, two-`npm install` setup worked but wasn't truly portable — nothing enforced that it would behave the same way on a different machine, and running frontend/backend separately was pure friction with no benefit at this project's size. npm workspaces hoists shared dependencies into one root `node_modules`, needs exactly one `npm install`, and lets `concurrently` run both dev servers from one `npm run dev`. The tradeoff: subfolder-local commands that depend on a subfolder-local lockfile (like `npm ci` run from inside `backend/`) no longer work, since `backend/package-lock.json` and `frontend/package-lock.json` were removed in favor of the root one — `docs/deployment.md`'s build steps were updated accordingly (`npm ci` from the repo root, `-w backend`/`-w frontend` for workspace-specific commands). Decided 2026-09-09.

## Forgot password: hashed, single-use tokens, not JWT or plaintext

**Decision**: self-service password reset uses a server-generated random token (32 bytes, `crypto.randomBytes`), sent to the user only in the email link. The database stores only its SHA-256 hash plus an expiry (1 hour), on the `User` row directly (`resetTokenHash`/`resetTokenExpiresAt`, unique + nullable) rather than a separate token table. `POST /auth/forgot-password` always returns the same generic message whether or not the email matched an account.

**Why**: three deliberate choices, each closing a specific real risk:
- **Random token, hashed at rest, not a JWT.** A JWT would need to be signed with something verifiable server-side anyway, and self-encodes claims that are more surface area than needed here — a single opaque random value compared against a hash is simpler and has no algorithm/claims-forgery class of bug to worry about at all. Hashing before storage means a database read (backup leak, SQL injection, insider access) can't be turned into a usable reset link — same reasoning as never storing a plaintext password.
- **Single-use, on the `User` row, not a separate table.** A dedicated `PasswordResetToken` table would allow multiple outstanding tokens per user; a single nullable column on `User` makes "at most one active reset in flight" structurally true — a new request simply overwrites the old token's hash, and a successful reset clears it, so a used or superseded link can never be replayed. This app's scale (a handful of internal users) doesn't need multiple-concurrent-reset support.
- **Generic response regardless of outcome.** Returning a different message (or a 404) for "no such account" vs. "account exists, email sent" would let the endpoint be used to enumerate which addresses have accounts on the system — a small but real information leak for an internal HR/security tool. The email-send failure path (`EmailService` throwing) is caught and logged server-side, never surfaced to the caller, for the same reason: a caller can't distinguish "no such account" from "account exists but the email provider had an outage" by response shape or timing.

Decided and implemented 2026-09-10. Reuses the existing `EmailService`/Microsoft Graph path (`sendPasswordResetEmail`) and the existing `USER_PASSWORD_RESET` audit action for the completion step (a new `PASSWORD_RESET_REQUESTED` action logs the request step, only when a real account matched, to avoid audit-log noise from arbitrary email addresses). Verified live end to end: invalid token → 400, valid token + short password → 400 validation, valid token + valid password → 200 and the new password logs in successfully, the same token reused a second time → 400 (confirms single-use), and a non-existent email → the identical generic response as a real one (confirms no enumeration leak).

## Fixing a deployment-blocking migration: a rare edit to an applied migration

**Decision**: edited migration `20260909120000_enable_row_level_security` (already applied to the live dev database) to guard its `ALTER TABLE "session" ENABLE ROW LEVEL SECURITY` statement behind a check that the table exists first, rather than adding a new forward-fixing migration.

**Why this is an edit, not a new migration**: migrations run in sequence, and the broken statement was *inside* an earlier migration — a new migration added after it would never get the chance to run, since `prisma migrate deploy` aborts the whole run on the first failure. Only editing the original statement could fix it. This is a deliberate, rare exception to "never edit an applied migration" (see `docs/developer-guide.md`'s conventions): that rule exists to prevent drift between environments that have already run the unmodified version, and as of this decision **nothing has ever been deployed** — this project's single Supabase dev database is the only environment that has ever executed this migration, so there is no other environment to drift from. Confirmed safe in practice: `prisma migrate status` and `prisma migrate deploy` both ran clean against the live dev database after the edit, no checksum-drift error.

**The bug itself**: `session` isn't part of the Prisma schema — it's created at runtime by `connect-pg-simple`, normally on the app's first boot, which happens *after* migrations run in a normal deploy sequence (`prisma migrate deploy` then `npm run start:prod`). The original migration's unconditional `ALTER TABLE "session" ...` only worked on this dev database because the app had already been run against it before the RLS migration was written, so the table already existed by then. On any environment starting from zero — a real production deploy, a CI/shadow database, `prisma migrate dev`'s shadow-database validation (which is how this was found, 2026-09-10, while adding the password-reset-token migration) — the statement fails with "table does not exist" and blocks every migration from that point on, indefinitely, since nothing after it can ever run. Fixed by wrapping it in `DO $$ IF EXISTS (...) THEN ... END IF; END $$;`, a no-op when the table isn't there yet, matching the RLS intent (enable it on `session` once it exists) without depending on a specific boot order.

## Working hours: reversed the original "never" exclusion, scoped narrowly

**Decision (2026-09-10, superseding the original spec's exclusion)**: the employee day view (`EmployeeDetails.tsx`) now shows a "Total working hours" figure — the span from the day's first ENTRY to its last EXIT (e.g. "7h 45m") — computed entirely client-side by `calcWorkingHours()` from the movement list already loaded for that page. Hidden when there's no EXIT yet for the day (nothing to compute a span from).

**Why this reverses a previously very firm rule**: the original spec, and every doc in this project up to 2026-09-09, stated "no working-hours calculation anywhere" as a permanent, explicit exclusion — this wasn't a casual default, it was called out repeatedly (README, developer-guide conventions, the dashboard summary endpoint's own code comment, `docs/testing.md`'s checklist). That exclusion is reversed here by explicit request. The scope is kept deliberately narrow to avoid quietly growing into the thing the original exclusion was guarding against (a payroll/timesheet system):
- **Frontend-only, derived from data already on the page.** No new backend endpoint, no new stored field, no aggregation across days. `GET /dashboard/summary` is explicitly untouched and still returns counts only (see its own code comment) — the reversal applies to the single-day, single-employee detail view only, not to any admin/reporting surface.
- **First-entry-to-last-exit only, not a real timesheet.** No handling of lunch/break gaps, no per-interval breakdown, no weekly/monthly roll-up, no export. `docs/user-guide-admin.md` states this explicitly as "not a timesheet" to set the right expectation for anyone assuming this is the start of one.
- **A future request to expand this** (multi-day totals, a payroll-facing report, per-gap breakdown) is a new, separate decision — it does not fall out of this one automatically, precisely because the original exclusion existed for a reason (this is a movement register, not a timesheet system) and only this one specific, narrow display was carved out of it.

## Auth cache fallback: any non-`ApiError` failure, not `!navigator.onLine`

**Decision**: `AuthContext.tsx`'s offline auth-cache fallback (falling back to the last-known logged-in user from `localStorage` when `/auth/me` can't be answered) now triggers on any failure that isn't an `ApiError` — a real 401/403 the server actually returned. It no longer also requires `!navigator.onLine`. The decision itself (`ApiError` vs. everything else) is factored into an exported `shouldUseCachedUser()` so it's unit-testable without rendering React (`frontend/src/auth/AuthContext.spec.ts`).

**Why**: found in the 2026-09-11 unused-code/issues audit. `navigator.onLine` only reflects whether the device has a network interface up — it says nothing about whether the app's own server is actually reachable. A dead backend, a DNS hiccup, or a dropped VPN all leave `navigator.onLine` at `true` while `fetch()` still throws (a plain `TypeError`, not an `ApiError`, since the request never got a response to reject on). The original condition required both `!(err instanceof ApiError)` *and* `!navigator.onLine`, so that whole class of "online but unreachable" failure fell through to `setUser(null)` — silently logging out a device with a perfectly valid, unexpired cached session, on a PWA whose entire offline story depends on staying logged in through exactly this kind of outage. `ApiError` alone is now the discriminator because it's the only signal that actually distinguishes "the server answered and rejected you" from "the request never got an answer for any reason" — the latter should always trust the cache (subject to its existing 12-hour expiry).

**Follow-up, 2026-09-23**: the module-level `cacheUser()` helper that writes to `localStorage` had no `try/catch`, unlike every other storage write added in later sessions. A throw here (private-browsing mode, quota exceeded, storage disabled by policy) propagated out of both call sites: on `login()`, it surfaced as a generic "Unable to sign in" error to `Login.tsx` despite the server having actually authenticated successfully (session cookie already set); on the initial `/auth/me` load path, it propagated into the `.catch()` handler above, where `shouldUseCachedUser()` sees a non-`ApiError` and falls back to `readCachedUser()` — which, since the write that would have populated the cache just failed, returns `null`, discarding the just-fetched valid session. Wrapped in `try/catch` (best-effort — caching is a convenience for offline reloads, not something either call site should fail on top of).

## ARIA: implicit label association (nested `<label>`), not `htmlFor`/`id`, for `.field`-pattern forms

**Decision**: fixed 24 form fields across `Employees.tsx`, `Users.tsx`, `AuditLog.tsx`, `Dashboard.tsx`, `Corrections.tsx`, and `Settings.tsx` where a `<label>` sat as a plain visual sibling of its `<input>`/`<select>`, with no `htmlFor`/`id` pairing and no `aria-label` on the control — meaning a screen reader announced the field with no name at all. Fixed by nesting the control *inside* the `<label>` (implicit association, valid HTML with no `id` needed) rather than adding matching `htmlFor`/`id` pairs. `Login.tsx`'s existing `htmlFor`/`id` fields were left as-is (already correctly associated).

**Why nesting over `htmlFor`/`id`**: several of the broken fields (`Settings.tsx`'s field list, mapped from an array; `Employees.tsx`'s add/edit forms, which repeat the same field shape for two separate forms on one page) generate their inputs from data or render more than one instance of the same logical field on a page — a generated `id` risks silent collisions (two elements sharing an `id` on the same page — the second `htmlFor` would point at the wrong element, or at nothing reliably). Nesting has no `id` to collide, so it's the more robust default for this codebase's pattern of dynamically-rendered fields; `Login.tsx` gets away with `htmlFor`/`id` because it's a static, single-instance form.

**Layout fix required alongside it**: `.field label { margin-bottom: 6px }` was written to space a label from its *sibling* input; nesting the input inside the label meant that margin no longer sat between the label text and the control. Added `.field label > input, .field label > select, .field label > div { margin-top: 6px }`, scoped to only the new nested pattern so `Login.tsx`'s sibling layout is untouched. Verified visually via Puppeteer screenshots of all six edited pages (Employees, Users, AuditLog, Dashboard, Corrections, Settings) — spacing and layout identical to before.

**What was checked and found already fine**: color contrast — every status/muted text color (`--text-muted` on white: 4.86:1, `--entry-green`/`--exit-red`/`--pending-amber` on their tints: all ≥4.6:1) passes WCAG AA; the only sub-3:1 color (`--brand-light`, 2.69:1 on white) is used exclusively for decorative SVG icons and hover borders, never for text, so it isn't a violation. Icon-only buttons: none exist without visible text — every button in the app pairs an icon with a text label already. `aria-live` status banners were already added in the prior 2026-09-10/11 pass.

## Last-admin lockout protection

**Decision**: `UsersService` now blocks two actions that could leave zero active users able to manage users at all: disabling the last remaining active user who holds `MANAGE_USERS` (`PATCH /users/:id/disable`), and changing that user's `roleId` away from a role that holds it (`PUT /users/:id`). Both return a clean `400` naming the problem instead of allowing it. "Admin" is defined by holding the `MANAGE_USERS` permission, not by the `ADMIN` role name specifically, so this stays correct if a future role is ever granted that permission too.

**Why**: found in the 2026-09-21 full-codebase audit. The frontend already had a client-side confirm dialog for disabling *your own* account, but nothing stopped an Admin from disabling every *other* admin first (each with no special warning, since that path only checked `user.id === currentUser.id`) and then confirming their own last — a total, unrecoverable lockout from Users/Settings/Audit Log, fixable only via direct database access. The client-side check alone was also never a real boundary (same principle as every other UI-level permission check in this app) — a direct API call could always bypass it. Server-side enforcement in `UsersService.assertNotLastActiveAdmin`/`assertRoleChangeKeepsAnAdmin` closes both the direct-API-call gap and the "several individually-fine steps add up to a lockout" gap the client-side warning couldn't see.

## Case-insensitive uniqueness for employeeCode and email

**Decision**: `EmployeesService` now checks `employeeCode` and `email` for a case-insensitive duplicate before create/update, returning `409` (naming the existing employee, for the email case) rather than relying on the database's own constraint.

**Why**: found in the 2026-09-21 audit. The `employeeCode` column's DB uniqueness constraint is case-sensitive, but every search in the app (`/employees/search`, `/employees/search-all`, the admin list) matches case-insensitively — so "EMP001" and "emp001" could otherwise both be created as distinct employees, both surfacing together in every search and making report filenames/email subjects ambiguous about which one is meant. `email` had no DB uniqueness constraint at all — two employees could share one email with no warning, risking a movement-record email reaching the wrong person. Application-level checks close both gaps without a schema migration (a DB-level case-insensitive constraint would need a `citext` extension or a functional index — deferred as unnecessary extra infrastructure while the app-level check is sufficient at this scale).

## Real server-reachability detection, not just `navigator.onLine`

**Decision**: added `GET /api/health` (public, does a real `SELECT 1`) and `frontend/src/api/health.ts`, which `SecurityHome.tsx` polls every 20s while `navigator.onLine` is `true`. The recording screen's offline banner now distinguishes "you are offline" (link down) from "the server is unreachable right now" (link fine, backend/DB unreachable) instead of showing nothing at all in the second case.

**Why**: found in the 2026-09-21 audit — the same class of gap already closed for auth (`AuthContext.tsx`'s `shouldUseCachedUser`, see above) existed on the recording screen too. `navigator.onLine` only reflects the network link layer; a device on working Wi-Fi with a captive portal, a dead backend, or a DNS hiccup still reports `true`. The recording flow already recovered correctly from this (a failed `fetch` gets queued, never silently lost), but the guard had no proactive warning — they only discovered a problem after tapping and waiting out the 20s request timeout. The same `/api/health` endpoint doubles as an external keep-alive target (see the deployment entry below) — one endpoint serving both needs.

## Offline sync retries on a timer, not only on browser online/offline events

**Decision**: `SecurityHome.tsx` now also retries `syncPending()` on a 20s interval whenever the connection is "effectively online" (link up **and** the server is reachable) and something is still queued, in addition to the existing retry-on-`online`-event behavior. A `beforeunload` warning now fires if anything is still pending sync when the guard tries to navigate away or close the tab.

**Why**: found in the 2026-09-21 audit (offline-queue data-loss review). The previous retry only fired when the browser's `online`/`offline` events fired — but those never fire for "the network link never dropped, the *server* was briefly unreachable when the tap failed and got queued." Without a timer-based retry, a movement queued during a transient server-side blip (not a real link drop) could sit unsynced indefinitely with no trigger to ever retry it. This doesn't eliminate the offline queue's core risk — it still lives only in the guard's browser IndexedDB with no server-side trace until it syncs, so clearing site data, uninstalling the PWA, or switching devices before syncing still loses it permanently and silently. The timer retry and `beforeunload` warning both shrink that risk window; neither closes it. A full fix would need a different architecture (e.g. a server-acknowledged offline channel) — deliberately out of scope here, flagged as a follow-up.

## Double-tap guard on ENTRY/EXIT

**Decision**: `SecurityHome.tsx` tracks a `submitting` flag; the ENTRY/EXIT buttons and the duplicate-confirmation dialog's buttons are disabled (with a spinner) for the duration of any in-flight `createMovement` call.

**Why**: found in the 2026-09-21 audit. Without this, a guard double-tapping (impatience, a slow connection, or the request sitting inside its 20s timeout window) could fire two concurrent requests. Each fresh tap generates its own idempotency key by design (see "Movement idempotency key" above — it dedupes *retries of the same tap*, not two distinct taps), so neither the idempotency check nor the same-type duplicate-confirmation check reliably catches two requests racing each other before either commits. Disabling the buttons while a request is in flight closes the double-tap window at the only point that actually prevents it — the UI never lets the second request start.

## Deploying to Render: Chrome must be installed as an explicit build-command step, not relied on via `postinstall`

**Decision**: Render's Build Command for the backend service now explicitly runs `npx puppeteer browsers install chrome` as its own step (`npm install --include=dev && npx puppeteer browsers install chrome && npm run build && npm run prisma:deploy`), rather than relying on it firing automatically via `backend/package.json`'s `postinstall` script. `PUPPETEER_CACHE_DIR=/opt/render/project/.cache/puppeteer` is also set as an env var on the service, so the installed browser persists into the same deploy's runtime container.

**Why**: found live, 2026-09-21 — the report-email feature 500'd in production with `Could not find Chrome`. Root cause, confirmed from the build log: Render restored a cached `node_modules` and npm's install reported "up to date," which skips re-running `postinstall` entirely — npm's fast-path only checks whether the dependency tree matches the lockfile, it has no way to know a `postinstall` script's *contents* changed. So even after `backend/package.json`'s `postinstall` was updated to install Chrome, a cache-hit build never ran it. Moving the install into the Build Command itself makes it run as an unconditional shell step every single build, immune to npm's cache-skip behavior. Confirmed fixed: the next build log showed `chrome@131.0.6778.204 /opt/render/project/.cache/puppeteer/...` actually downloading, and "Email Details" was verified working end to end in production afterward.

## Employee search: blank query returns a browse list, not nothing

**Decision**: `/employees/search` and `/employees/search-all` now return the first 10 employees alphabetically when `q` is blank/omitted, instead of an empty array. The frontend (`SecurityHome.tsx`, `Dashboard.tsx`, `Corrections.tsx`) fetches this immediately when the search input gains focus, in addition to the existing debounced fetch on typing.

**Why**: reported directly by the user — clicking/tapping an empty employee search box showed nothing at all until you started typing, which reads as broken/unresponsive rather than "type to search." A blank-query "browse" list (still capped at 10, still sorted alphabetically, same shape as a real search result) makes the box show something useful the instant it's focused, with no behavior change once typing starts. Decided 2026-09-21.

**Follow-up, same day**: this surfaced a second bug — `SecurityHome.tsx`'s search input had `autoFocus`, so the browse dropdown opened automatically the instant the page loaded, before any click, and none of the three search boxes (`SecurityHome.tsx`, `Dashboard.tsx`, `Corrections.tsx`) had a click-outside handler to dismiss it. It stayed open over the rest of the page (including the Dashboard link) until an employee was picked. Fixed by: removing `autoFocus`; adding a `dropdownOpen` boolean state per page (separate from the results array, so results can stay cached without the dropdown staying visible); and a `mousedown` listener on `document` that closes the dropdown when the click target is outside the search box's ref. Reported directly by the user.

## Keep-alive: `/api/health` + a scheduled GitHub Actions ping

**Decision**: added `.github/workflows/keep-alive.yml`, a scheduled job (`*/10 * * * *`, plus manual `workflow_dispatch`) that curls the backend's `/api/health`. An external uptime monitor (e.g. UptimeRobot, free tier) pinging the same URL is the recommended primary mechanism; the GitHub Actions workflow is a free redundant second pinger.

**Why**: Render's free tier spins the backend down after 15 minutes idle (30–60s cold start on the next real request — bad for a guard waiting at the gate), and Supabase's free tier auto-pauses a project after 7 days with no database activity. `/api/health` does a real `SELECT 1`, so one ping addresses both: it's an inbound HTTP request (keeps Render awake) that also touches the database (keeps Supabase from pausing). GitHub Actions alone was considered insufficient as the *only* mechanism: scheduled workflows auto-disable after 60 days with zero commits/pushes to the repo, and fail silently with no alert when that happens — an external uptime monitor has no such inactivity clock and typically alerts on real downtime too, so it's the recommended primary with GitHub Actions kept as a free backup. Decided 2026-09-21.

**Follow-up, 2026-09-22**: the workflow's first 3 scheduled runs all failed (reported by the user). Two compounding causes, both confirmed by direct measurement: (1) `curl --max-time 25` was shorter than a real observed cold start (timed at 33s against the live Render instance) — bumped to `--max-time 100`; (2) more fundamentally, GitHub's `schedule` trigger did not actually fire every 10 minutes as configured — the 4 runs that existed were spaced 2.5–5.5 hours apart, not 10 minutes, confirming GitHub's own "best-effort, not exact" caveat (already noted in the workflow's comments) is severe enough in practice that the workflow cannot be relied on as the actual keep-alive mechanism at this interval. This strengthens rather than changes the recommendation above: an external uptime monitor with real fixed-interval scheduling is the only mechanism that actually keeps the 10-minute cadence this system needs; GitHub Actions remains a free backup only.

**Follow-up, 2026-09-25**: the predicted consequence of the above showed up in practice — the user reported the backend was sleeping again. Re-checked the workflow's run history directly via the GitHub API: still active (not auto-disabled), but still firing every 3–5 hours, not 10 minutes, confirming the 2026-09-22 finding was not a fluke. Fixed by setting up UptimeRobot (free tier) as the primary pinger, `https://adage-security-system.onrender.com/api/health`, checked every 8 minutes — the user's first attempt pointed the monitor at the Vercel frontend URL instead, which doesn't help (static hosting never sleeps, and it never touches Supabase), corrected to the backend `/api/health` URL. Confirmed live: 100% uptime, 0 incidents since setup.

## Multi-device offline recording: per-employee advisory lock, and a local roster cache for offline search

**Decision**: two fixes made together while auditing what happens with several guards on several devices recording concurrently:

1. `MovementsService.createMovement`'s "read last movement, then decide whether to write" logic now runs inside a Postgres transaction that first takes `pg_advisory_xact_lock(employeeId)`. This serializes concurrent requests for the *same* employee (any other employee's request proceeds immediately, uncontended) and releases automatically when the transaction commits or rolls back — no explicit unlock needed, no risk of a held lock surviving a crashed request.
2. New `GET /employees/offline-cache` (full active roster, `VIEW_DASHBOARD`) is fetched by the Security frontend on load and every 5 minutes while online, and cached in `localStorage` (`frontend/src/offline/employeeCache.ts`). Employee search now falls back to this cache whenever the app is offline, or a live search call fails despite `isEffectivelyOnline` being true.

**Why**: (1) — without a lock, two guards on two different devices tapping for the same employee within the same instant could both read "last movement" before either commits, both miss the same-type duplicate-confirmation check, and both create a record with no warning shown to either guard. Single-device double-tap was already guarded (a `submitting` flag on the frontend), but that does nothing for two independent devices. An advisory lock was chosen over a DB-level unique/exclusion constraint because the rule being enforced ("don't silently duplicate the same movement type back-to-back") isn't a static uniqueness constraint — it's conditional on `confirmed` and on what the *current* last record is, which needs an application-level read-then-decide step; the lock makes that read-then-decide step atomic per employee without blocking unrelated employees. Verified against the real database (not just a mocked unit test) with two concurrent connections: the second visibly waited for the first to release the same lock key, while two different employees' lock keys ran fully concurrently with no waiting.

  One implementation pitfall worth recording: `pg_advisory_xact_lock()` returns `void`, which Prisma's `$queryRaw` cannot deserialize into a row (throws `P2010`, "Failed to deserialize column of type 'void'") — this only surfaced when tested against the real database, not in the mocked unit test. Use `$executeRaw` for it instead, which doesn't attempt to parse a result set.

2. — `/employees/search` is deliberately `NetworkOnly` in the service worker (see the PWA offline-queue decision), and there was previously no local copy of the roster at all. A guard who opened the app already offline, or went offline before selecting a new employee, had no way to find anyone — offline recording only worked for someone already selected before the connection dropped. A local roster cache closes that gap cheaply: the roster is small enough (~200 employees, lightweight fields only) to keep entirely in `localStorage`, refreshed opportunistically whenever the app can reach the server, and a slightly stale cached roster is strictly better than none. Verified end-to-end: cached the full roster while online, went genuinely offline (Puppeteer + real network emulation), searched, and got correct matching results.

Also fixed alongside these: `enqueueMovement()` (IndexedDB) can reject — private-browsing restrictions, storage quota, a locked-down device profile — and the two `SecurityHome.tsx` call sites previously awaited it with nothing catching a failure, so a rejection would silently drop the guard's tap with no banner shown at all. Both are now wrapped in `try/catch` with a visible error banner; `refreshPendingCount` (also IndexedDB, called from several places, some fire-and-forget) got the same treatment as a single point of defense for all its callers.

**Follow-up, 2026-09-23**: the advisory-lock transaction was using Prisma's default `$transaction` options (5s `timeout`, 2s `maxWait`), sized for a typical single-row transaction. Under a burst of concurrent taps for the *same* employee — several devices' offline queues syncing at once after a shared outage — requests queue up behind the lock, and if total queue time exceeded 5s, later requests would throw a generic transaction-timeout error instead of completing (caught cleanly, not a crash, but a confusing manual-retry for the guard). Widened to `{ maxWait: 10_000, timeout: 20_000 }`. Also found in this follow-up: `SecurityHome.tsx`'s `syncPending()` had an unguarded `listPendingMovements()` call — its sibling `refreshPendingCount` got the IndexedDB-failure guard described above, but `syncPending` itself was missed; since it's invoked from a repeating 20s interval, this would have produced a repeating unhandled rejection rather than a one-off failure. Fixed the same way.

## Report-generator timeout: only a timeout discards the pooled browser, not any render error

**Decision**: `ReportGeneratorService.renderWithPuppeteer` races the actual render against a 30s timeout (`Promise.race`). The pooled browser is discarded and relaunched on the *next* call only when that race times out, or when `browser.newPage()` itself throws (as opposed to a clean `'disconnected'` event, already handled separately). An ordinary render failure inside `action` (e.g. `generatePng`'s own "page layout unavailable" check) does **not** discard the browser.

**Why**: the existing `'disconnected'` listener (see the pooled-Puppeteer-browser decision) only catches a browser that actually crashes. It does nothing for one that's still technically connected but wedged — a hung renderer process, a `page.setContent` that never resolves — which would otherwise hang every future report request behind the same stuck instance forever, with no way to notice or recover short of a full process restart. A raw try/catch around the render call isn't enough on its own, since a hang never throws at all — it just never resolves. The narrower "only a timeout counts as unhealthy" rule matters because a naive "discard on any error" would force-relaunch a perfectly fine browser on every ordinary bad-input error, paying a real relaunch cost for something that says nothing about the browser's health. Verified with a mocked-Puppeteer test suite (`report-generator.service.spec.ts`): a `newPage()` failure retries once with a fresh launch; a real timeout (simulated with fake timers and a `setContent` that never resolves) discards the pooled browser and the next call launches a clean one; an ordinary render error leaves the pooled browser in place and reused. Found in the 2026-09-22 crash-risk audit — flagged as the one genuine, un-mitigated risk on that list worth scheduling.

## Settings: one "Save all changes" form, not a Save button per field

**Decision**: `Settings.tsx` was rebuilt around a single form with one "Save all changes" button, client-side required/format validation before submit, an "Unsaved changes" indicator, and a centered save confirmation — replacing four independent per-field Save buttons. Only fields that actually differ from the last-known-persisted values are sent to the server (`PUT /settings/:key`, one call per changed key, in parallel).

**Why**: every other form in the app (Employees, Users, Corrections) already saves as one action — the per-field pattern was the odd one out, and read as unpolished/unfinished next to the rest of the app. Comparing `draft` against `saved` (the last-fetched-or-saved values) rather than tracking a separate boolean "dirty" flag by hand means the unsaved-indicator and the save button's enabled state can never drift out of sync with what's actually different. Found in the 2026-09-22 UX audit.

## Duplicate-confirmation dialog carries `lastMovementAt`, not just the type

**Decision**: `MovementsService.createMovement`'s `requiresConfirmation` response now includes `lastMovementAt` (the conflicting record's own timestamp) alongside `lastMovementType`. `SecurityHome.tsx`'s confirmation dialog shows the employee's name, the last-recorded time, and an explicit "this would record X twice in a row" sentence before the guard confirms, instead of the bare "already marked as inside/outside" with no time context.

**Why**: a guard asked to confirm a plausible-but-ambiguous action ("already marked as inside — record another ENTRY?") with no idea *when* the conflicting record happened has to trust the system blind or go check the Dashboard first. Showing the actual time turns it into a decision the guard can actually verify against what they remember (e.g. "that was this morning, this is a different shift — yes, record it"). Found in the 2026-09-22 UX audit.

## Audit Log gets a date range + keyword search, on top of the existing entity/user filters

**Decision**: `GET /audit-logs` accepts optional `from`/`to` (`YYYY-MM-DD`, reusing `dayRange()`'s local-day boundary logic) and `q` (case-insensitive substring match across `action`, `entityType`, `ipAddress`, and the performing user's `name`, combined with `OR`). Results are already always newest-first (`orderBy: { createdAt: 'desc' }`) — confirmed as the intended default, not changed.

**Why**: the audit log was the one major admin table with no date filter at all, despite being the tool an admin reaches for specifically to investigate "what happened around such-and-such time." A keyword search across the fields an admin would actually search by (rather than requiring a specific entity-type/user dropdown selection first) makes it usable as a real investigation tool instead of just a browsable list. Found in the 2026-09-22 UX audit.

## Post-login welcome banner, shown once via a sessionStorage flag

**Decision**: `Login.tsx` sets a `sessionStorage` flag (`adage.just-logged-in`) immediately before navigating on a successful login. `WelcomeBanner.tsx`, mounted on whichever page the user lands on (`SecurityHome` or `Dashboard`, matching the existing role-based redirect), reads and immediately clears that flag on mount, showing a dismissible "Welcome back, [name]" banner with a one-line role-specific next action.

**Why**: `sessionStorage` (not router `location.state`) survives exactly as long as it needs to and no longer — cleared on read, so a page refresh or the browser back button never resurfaces it, without needing to coordinate a `history.replaceState` call or thread state through a redirect. Found in the 2026-09-22 UX audit.

## Backfill migration for a schema change made directly against the database

**Decision**: `Employee.phone`/`department`/`designation` were dropped directly in Supabase (2026-09-22, manually) rather than through `prisma migrate`; `schema.prisma` and all referencing code (DTOs, import script, frontend types) were updated to match in a separate commit at the time. A follow-up migration, `20260924100000_drop_employee_metadata_columns`, was added afterward purely to keep the migration *history* consistent with what actually happened — `ALTER TABLE employees DROP COLUMN IF EXISTS ...`, applied via `prisma migrate deploy`.

**Why**: against the live database this migration is a genuine no-op (`IF EXISTS` — the columns were already gone) — verified live before and after applying it (`/employees` and `/employees/search` both still return clean 200s). Its only purpose is for any *future* from-scratch database build: without it, replaying the full migration history in order would still recreate these columns via the original `20260903103752_init` migration, leaving a freshly-built database subtly different from the live one. Harmless either way — Prisma Client only ever reads/writes what's declared in `schema.prisma`, so an extra unused column on a fresh DB can't cause an error — but confusing to anyone diffing a new environment against production. Worth doing whenever a schema change is made outside Prisma's own migration flow, not just this once.

## Mobile card-view markup: every records-table needs a matching .record-cards sibling

**Decision**: `global.css` hides `.records-table` and shows `.record-cards` instead below `max-width: 640px` — a page must render *both* markup blocks (table for desktop, cards for mobile) for its data to be visible at any width. `Dashboard.tsx` had always done this correctly; `AuditLog.tsx`, `Corrections.tsx`, `Employees.tsx`, and `Users.tsx` did not — they rendered only the table. Fixed by adding `.record-cards`/`.record-card` markup to all four, matching Dashboard's structure (each row's key fields plus its action button(s), stacked).

**Why**: found via a full mobile-viewport audit (360/390/428px, all 3 roles, every route) run 2026-09-25 — these four pages silently showed **zero rows on every phone size**, with no error and no empty state (the genuine "no data" empty state only fires when a fetch actually returns nothing, so this bug was invisible unless someone opened the page on a narrow screen and looked). This affected every ADMIN session on Audit Log/Corrections/Users and every ADMIN+HR session on Employees — i.e. the two roles responsible for reviewing/managing data couldn't do so from a phone at all. The guard-facing SecurityHome/Dashboard screens (the actual daily-use pages) were unaffected and already solid on mobile. Verified fixed live in a mobile-viewport browser session after the change: all four pages render full card content with the table correctly hidden, no new horizontal overflow. Any *new* table-based admin page must include matching `.record-cards` markup from the start, or it will silently fail on mobile the same way.

**Follow-up, same day**: the same audit flagged two tap targets under the ~44px accessibility guideline — `WelcomeBanner.tsx`'s dismiss (×) button (28×28px) and, on mobile only, Dashboard's `.record-card` employee-name link (~20px tall, since it's just an inline text link with no padding of its own). Fixed: the dismiss button now has a 44×44px hit area via `minWidth`/`minHeight` around the same visible icon; the employee-name link gets `padding: 10px 0; margin: -10px 0` inside `.record-card` only (a mobile-scoped CSS rule, `frontend/src/styles/global.css`'s `max-width: 640px` block) so the tap area grows without shifting surrounding layout or affecting the same link's desktop table-row appearance.

## Email uniqueness must match everywhere case-insensitively, not just at login

**Decision**: `UsersService.create`/`update` and `AuthService.requestPasswordReset` now match email case-insensitively (`{ equals: email, mode: 'insensitive' }`, or `findFirst` instead of `findUnique` where the field is a unique column and Prisma won't accept `mode` on `findUnique`), matching how `AuthService.validateUser` has always resolved login by email.

**Why**: found via a full-codebase audit (2026-09-25) targeting logic missed by the earlier `EmployeesService.assertCodeAndEmailAvailable` fix (2026-09-21, which closed this exact gap for Employees but never got applied to Users). Without it, two user accounts differing only by email case (`HR@adage.com` / `hr@adage.com`) could both be created — the DB's unique constraint on `email` is Postgres-default case-sensitive, so neither the create-time check nor the DB itself caught it — leaving one account effectively unreachable by email login (an ambiguous `findFirst` order decides which one authenticates). Separately, `requestPasswordReset`'s exact-match lookup meant a user typing different casing than their stored email got the generic "if that email exists…" response but no email ever actually sent, while login with that same casing would have worked fine. Neither is a security issue (case-insensitive matching is the *more* permissive direction, and the generic password-reset response already prevents enumeration either way) — both are real correctness/UX gaps now closed to match login's existing behavior everywhere.

## Debounced search needs a stale-response guard, not just a debounce

**Decision**: `SecurityHome.tsx`, `Dashboard.tsx`, `Corrections.tsx`, and `Employees.tsx`'s employee-search fetches now track a monotonic request-sequence number (a `useRef` incremented on every call) and discard a response if a newer request has since been issued — `if (seq !== seqRef.current) return;` before any `setState` call.

**Why**: found via a full-codebase audit (2026-09-25) — the existing debounce (a `setTimeout` reset per keystroke) only delays *sending* a request; it does nothing to cancel or sequence requests already in flight. On a flaky connection — exactly the condition this app is built around, guards searching from a gate with unreliable wifi — a slower response for an earlier, now-stale query could resolve after a faster response for the current query, flashing outdated results over correct ones with no visible indication anything went wrong. Considered threading an `AbortController` through the shared `api` client (`frontend/src/api/client.ts`) instead, which already uses one internally for its 20s request timeout — but its `request()` function has no signal-injection point today, and adding one would touch every caller across the app for a fix only four call sites need. The sequence-counter approach is scoped to exactly the affected code, at the cost of not actually cancelling the now-wasted in-flight request (a minor inefficiency, not a correctness issue).

## Settings "Save all changes" must not lose track of partial success

**Decision**: `Settings.tsx`'s `saveAll()` now uses `Promise.allSettled` across the batch of changed-field `PUT /settings/:key` calls instead of `Promise.all`, reconciling the `saved` baseline only for fields that actually succeeded and showing a distinct "Saved N, but M failed" message when the batch is a mix.

**Why**: found via a full-codebase audit (2026-09-25) — `Promise.all` rejects as soon as any one promise rejects, which skipped the `setSaved` reconciliation step entirely even for fields that *had* already persisted server-side in the same batch. Those fields then stayed marked "unsaved changes" client-side (and would be silently re-sent, harmlessly, on the next attempt) while the blanket "Unable to save changes" message implied nothing had saved at all — a real, if low-frequency (requires a mid-batch failure), correctness gap in the single-save-button model chosen in the 2026-09-22 UX pass.

## Two forms were missing the double-submit guard every other form already has

**Decision**: `Employees.tsx`'s and `Users.tsx`'s "Add" forms now track a `creating` boolean and disable their submit button while a create request is in flight, matching the pattern already used by `Corrections.tsx` and `Settings.tsx`.

**Why**: found via a full-codebase audit (2026-09-25) — these two forms had no such guard, so a fast double-click or double-Enter could fire two `POST` requests before the first one's response disabled anything. No data corruption results (the backend's uniqueness checks — `employeeCode`, `username`/`email` — return a clean `ConflictException` on the second request), but the admin sees a confusing "already exists" error on an action that should have simply succeeded once.

## Unbounded `take` on the audit log

**Decision**: `AuditLogService.list()` now caps `take` at 200 (`Math.min(params.take ?? 50, 200)`) regardless of what the caller requests.

**Why**: found via a full-codebase audit (2026-09-25) — `GET /audit-logs` accepted an arbitrary `take` from any ADMIN session (the only role with `MANAGE_SETTINGS`), which could force one very large query/response with no cap. Low likelihood (admin-only, no known abuse case) but a cheap, obviously-correct fix.

## Open deployment risks, not yet addressed (need a decision, not just code)

Found via a full-codebase audit (2026-09-25), deliberately left open pending user input since each needs new infrastructure or an account, not a code change:

- **No database backups exist at all.** Supabase's free tier does not include PITR/automated backups (confirmed — that's a paid-tier feature; `docs/deployment.md`'s own pre-deploy checklist already has this item unchecked). Today, if the Supabase project were accidentally deleted, corrupted, or a bad migration/manual SQL command wiped data, there is no recovery path. Cheapest mitigation on the table: a scheduled `pg_dump` (a GitHub Actions cron, similar in shape to the existing `keep-alive.yml`) to a private storage location — even weekly beats nothing. Not implemented; needs a decision on where dumps get stored and how often.
- **No error tracking/alerting.** No Sentry/Bugsnag/equivalent in either `package.json` — a production crash or unhandled exception surfaces only via Render's own log dashboard (not proactively watched) or a user complaint after the fact. Sentry's free tier would cover this for the backend at this scale. Not implemented; needs a Sentry account and a decision on whether frontend error tracking is also wanted.
- **CI is informational only, not a merge gate.** `.github/workflows/ci.yml` runs lint/tests/build on every push/PR, but branch protection (a GitHub repo setting, not a file in this repo) isn't confirmed enabled, and Render auto-deploys on push to `main` independent of CI's result. Worth confirming branch protection is actually turned on if a red CI run should ever block a deploy.
- **`prisma migrate deploy` failure mode on Render is unverified.** Whether a failed migration mid-deploy aborts the start command (safe) or lets the app boot against a half-migrated schema hasn't been tested. Worth a deliberate dry run before the next non-trivial schema migration.

## Security CC is the sending account's own email, not a global setting

**Decision**: Adage now runs multiple security units — as of 2026-09-25, two (`securityunit1@adage-automation.com`, `securityunit2@adage-automation.com`), each a single shared login account used by 2-3 guards physically at that unit (not one account per guard). The global `SECURITY_EMAIL` Settings key is removed entirely — `ReportsService.emailDailyRecord` now looks up the *sending* account's own `User.email` (fetched by `requestedByUserId`, already passed through from the session) and CCs that. HR/Admin accounts (which also hold `SEND_EMAIL`, same as Security) send with no CC at all when triggered by them, rather than falling back to any default address — confirmed with the user rather than assumed.

**Why**: initially considered adding a *new*, separate `securityCcEmail` field on `User` (distinct from their login `email`, which is unique) so multiple individual guard accounts could share one CC value without violating the DB's uniqueness constraint. Turned out unnecessary once the actual login model was clarified: each unit is *one* shared account (2-3 guards use the same username/password), not several individual guard accounts — so that account's own `email` field already holds the unit's address uniquely, no new column needed. This also means whichever unit's guards are actually logged in and click "Email Details" determines the CC automatically, with zero extra configuration per send and no risk of the wrong unit's address being used.

**What this replaced**: the single global `SECURITY_EMAIL` Settings key (`backend/src/common/constants/settings-keys.ts`, `SettingsService.getSecurityEmail()`, the Settings page's "Security Email" field) — removed entirely, along with its seed-script default. Existing `settings` table rows for that key are simply unused now (harmless, not cleaned up). Two units sharing one login account each is today's reality, not a hard ceiling — if a third unit is added later, it just needs its own account with `email` set to its shared address; no code change required.

**Operational follow-up needed**: `securityunit1@adage-automation.com` and `securityunit2@adage-automation.com` must actually exist as real mailboxes for the CC to deliver anywhere — this is a literal outgoing recipient now, not just an app config value. See `docs/branding-and-data-needed.md`.

## Database backups: scheduled pg_dump via GitHub Actions, and backend error tracking via Sentry

**Decision**: two of the open deployment risks flagged in the 2026-09-25 audit above were closed the same day, on explicit user confirmation, rather than left open:

- **`.github/workflows/db-backup.yml`** — a daily scheduled job (`workflow_dispatch` also available for a manual run) that runs `pg_dump` against a *direct* (session-mode, not pooled) database connection, gzip-compresses the plain-SQL output, and uploads it to the same Supabase Storage bucket already used for emailed reports, under a `db-backups/` prefix. Prunes down to the last 14 backups on every run so it doesn't silently grow into the shared 1GB free-tier storage cap.
- **`@sentry/node`** added to the backend (`backend/src/main.ts` initializes it only if `SENTRY_DSN` is set — unset is a safe no-op, matching this app's pattern of optional config never blocking startup). `AllExceptionsFilter` (`backend/src/common/filters/all-exceptions.filter.ts`) now also calls `Sentry.captureException()` for any genuine 5xx, alongside its existing `Logger.error()` call — routine 4xx client errors are still not reported, same signal-to-noise reasoning the filter already used for logging. Tracing/performance monitoring deliberately not enabled (`tracesSampleRate: 0`) — this is error visibility only, to stay simple and within Sentry's free tier.

**Why**: Supabase's free tier has no automated backups or point-in-time recovery at all — before this, an accidentally deleted/corrupted project or a bad migration/manual SQL command meant the live data was simply gone, no recovery path. And before Sentry, a production crash surfaced only via Render's own log dashboard (not proactively watched) or a user complaint after the fact — both real, unmitigated gaps at this app's actual production scale, not hypothetical.

**What still needs manual setup**: the backup workflow needs `BACKUP_DATABASE_URL` (a **session-mode** connection URI — the app's own transaction-mode `DATABASE_URL` on port 6543 doesn't work with `pg_dump`; use Supabase's "Session pooler" string on port 5432 rather than "Direct connection", which resolves to IPv6 only and is therefore unreachable from GitHub-hosted runners) and the same `STORAGE_*` values already in `backend/.env`, added as separate GitHub Actions repo secrets (Actions can't read Render's environment) — see the comment block at the top of the workflow file. Sentry needs a free account and a DSN, set as `SENTRY_DSN` in Render's environment (and optionally `backend/.env` for local testing) — until that's done, both features are inert but harmless (the workflow fails fast with a clear "missing secrets" message rather than silently doing nothing; Sentry's `Sentry.init` is simply skipped).
