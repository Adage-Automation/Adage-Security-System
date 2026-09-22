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

## Employee search: top 10, server-side, debounced

**Decision**: `/employees/search` returns at most 10 matches, queried server-side (not a full client-side list), with the frontend debouncing input before each request.

**Why**: keeps the guard's autocomplete list short enough to fit a phone screen without scrolling (spec §7/§48), and avoids loading the entire employee table into the browser as the company grows (spec §53). Decided 2026-09-03.

## Report rendering: HTML/CSS + headless browser

**Decision**: reports are an HTML/CSS template rendered via Puppeteer to both PNG (`page.screenshot`) and PDF (`page.pdf`) from the same template. Not a canvas-drawing library, not a screenshot of the live web page.

**Why**: the spec explicitly forbids a screenshot-of-the-webpage approach and wants "a proper structured report image." A single HTML template rendered two ways keeps PNG and PDF visually identical and easy to restyle later, versus maintaining two separate drawing implementations (canvas + a separate PDF library). Decided 2026-09-03.

## Offline handling: full offline queueing

**Decision**: v1 includes offline queueing via IndexedDB and a service worker, not just a "fail and ask the guard to retry" message. A queued movement is visibly distinct from a confirmed save ("pending sync" banner) until the server confirms it. A queued movement that comes back `requiresConfirmation` during sync is flagged as a **conflict** and surfaced to the guard for intentional resolution ("Record anyway"), rather than auto-confirmed — the auto-confirm path from the 2026-09-04 audit was replaced with explicit conflict review because silently recording a duplicate without the guard knowing is worse than a short queue review.

**Why**: considered against the simpler fail-clearly-no-queue alternative. Given guards work from a gate that may have unreliable wifi, and the core promise of the app is "never falsely report success," a real offline queue was judged worth the added complexity (dedup on sync, visible pending state). Decided 2026-09-03; conflict-surface behavior updated 2026-09-10 — see `docs/roadmap.md`.

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
