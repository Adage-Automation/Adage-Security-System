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

**Decision**: v1 includes offline queueing via IndexedDB and a service worker, not just a "fail and ask the guard to retry" message. A queued movement is visibly distinct from a confirmed save ("pending sync" banner) until the server confirms it.

**Why**: considered against the simpler fail-clearly-no-queue alternative. Given guards work from a gate that may have unreliable wifi, and the core promise of the app is "never falsely report success," a real offline queue was judged worth the added complexity (dedup on sync, visible pending state). Decided 2026-09-03 — see the caveat in `docs/roadmap.md` about conflict-handling depth still being minimal.

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
