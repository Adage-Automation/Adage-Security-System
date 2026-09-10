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

**Decision**: `AuthContext.tsx` caches the last successfully authenticated user in `localStorage` (key `adage.last-authenticated-user`) with a 12-hour expiry. If `/auth/me` fails and the browser is offline (no `ApiError`, but no network), the cached user is restored so the recording screen and offline queue remain usable. For any real online API call, the server session is always the authority — the local cache is only used when there is genuinely no network.

**Why**: without this, a guard whose device lost connectivity but still had an active session would see the login screen on reload, losing access to the recording screen and any queued movements, even though the session is still valid server-side. The 12-hour window is short enough to prevent stale credentials persisting indefinitely (guards typically work one shift), and the cache is cleared explicitly on logout. Decided 2026-09-10.

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
| HR | same as Security, plus `MANAGE_EMPLOYEES` | Record Movement, Dashboard, Employees |
| ADMIN | every permission | everything, including Users, Corrections, Audit Log, Settings |

**Why**: user explicitly asked to restrict the admin-nav pages (Employees/Users/Corrections/Audit Log/Settings) by role — Security limited to Dashboard, HR additionally getting Employees, everything else Admin-only. `RECORD_ENTRY`/`RECORD_EXIT` were deliberately left granted to all three roles: the request was scoped to the secondary admin pages, not the core recording workflow that's every role's baseline. `VIEW_EMPLOYEE_HISTORY`/`SEND_EMAIL`/`DOWNLOAD_REPORT` were kept for Security and HR too, since the Employee Details "View Employee Day" + "EMAIL DETAILS" drill-down is reachable from the Dashboard both roles now keep, and removing those permissions would have silently broken a workflow the user didn't ask to remove.

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

**Decision**: switched the email-sending implementation from Resend (the original build's default choice) to SMTP through Adage's own Microsoft 365 tenant for `adage-automation.com`. Full provider comparison and history in `docs/email-provider-options.md`.

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
