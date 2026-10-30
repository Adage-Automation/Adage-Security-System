# AI Agent Context — Start Here

This file is the onboarding doc for a **new AI agent (or human)** picking up this project cold. It doesn't duplicate the existing docs — it orients you to them, and captures the operational knowledge that isn't written down anywhere else (workflow discipline, current state, known gaps). Read this first, then follow the links as needed.

## What this project is

**Adage Security System** — a responsive web app (installable as a PWA) that replaces a manual paper security register. Security guards tap **ENTRY**/**EXIT** for an employee at the gate; HR/Admin can browse that history, email a day's record on demand, and (HR/Admin only) view an analytics dashboard (**Insights**) built from the same movement data.

**Critical framing, repeated because it shapes a lot of design decisions**: this is a **secondary/backup attendance record**, not the system of record — employees already punch attendance in a separate app (FactoHR). This exists so a guard's independently-noted gate time can resolve a FactoHR dispute or gap. Don't build toward "this becomes the real attendance system" — it's explicitly not meant to.

Full detail: **[README.md](../README.md)** (features, tech stack, design principles) and **[docs/architecture.md](./architecture.md)** (module layout, request lifecycle, timezone handling).

## Where everything is

```
backend/   NestJS + TypeScript + Prisma — src/<module>/ (auth, users, roles, permissions,
           employees, movements, dashboard, reports, email, audit-logs, settings, insights, health)
frontend/  React + TypeScript + Vite, PWA — src/pages/ (one file per screen), src/components/,
           src/offline/ (IndexedDB queue), src/api/client.ts (plain fetch wrapper, no axios/react-query)
docs/      The full documentation set — see "Where to go deeper" below
CHANGELOG.md   Dated, narrative history of every change — read this to understand *why*,
               not just *what*. More detailed than most changelogs; worth skimming the tail.
```

Run everything from the repo root with npm workspaces — one `npm install`, one `npm run dev` (runs backend on **:4000** and frontend/Vite on **:5173** concurrently). See `package.json` at the root for every available script (`npm run build`, `npm test`, `npm run seed`, `npm run prisma:migrate`, `npm run load:test`).

Test login credentials: seeded by `backend/prisma/seed.ts` — check that file (not reproduced here, since this file may end up in places a credential shouldn't be pasted). Three roles exist: `SECURITY`, `HR`, `ADMIN`.

## Where to go deeper (don't re-derive what's already written)

| Question | Doc |
|---|---|
| Why was X built this way? | `docs/decisions.md` — the architecture decision log. Check here before re-litigating a design choice; most "why not just..." questions are already answered. |
| What does the system look like end to end? | `docs/architecture.md` |
| Database schema? | `docs/database-schema.md` |
| API surface? | `docs/api-reference.md` |
| How to deploy / env vars / current hosting? | `docs/deployment.md` (Render + Supabase, free-tier path) |
| Security model, RBAC, auth? | `docs/security.md` |
| Manual test checklist? | `docs/testing.md` |
| What's left to do / known gaps? | `docs/roadmap.md` — kept current, check this before assuming something is unbuilt |
| Role-specific user guides? | `docs/user-guide-admin.md`, `-hr.md`, `-security.md` |
| Full change history with rationale? | `CHANGELOG.md` |

## Operating rules for anyone working in this repo (critical)

This is a **live production system with real guard-recorded data**, and local dev commonly points at the **same Supabase database** as production (shared dev/prod). That changes how you should work here:

1. **Never run a destructive DB operation without explicit, double-confirmed user approval.** No exceptions for "it's just test data" — assume it isn't unless proven otherwise.
2. **Never `git commit` or `git push` unless explicitly asked.** Even then, scope the commit to what was actually asked for.
3. **Verify every change the same way, every time**: typecheck → unit tests (backend *and* frontend) → build (backend *and* frontend) → restart the relevant process (kill the port, rebuild, relaunch) → live verification against real data (Playwright or manual) before calling anything done. A green typecheck is not "done."
4. **If the user tells you not to document something, honor that indefinitely** — don't reconstruct it from git history/diffs later and write it up anyway. If you're ever unsure whether something is covered by a prior "don't write this down" instruction, ask rather than guess.
5. **When a change touches a shared/global pattern** (a helper function many call sites use, a CSS class many pages share), check all call sites before assuming a local fix is enough — this codebase has a strong "fix once at the shared chokepoint" convention (see `decisions.md` for examples), not scattered per-caller patches.

## Known open items (check before assuming these are unresolved or resolved)

- **Render `DATABASE_URL` connection_limit — not yet confirmed set.** Supabase's pooler caps total session connections at 15; Prisma defaults to 8 per instance if the connection string doesn't specify `connection_limit`. Local dev is already fixed (`?connection_limit=3`). Production's env var has **not yet been checked/fixed** — see `docs/roadmap.md`'s "Blocked" section for the full writeup and the exact fix (append `?connection_limit=10` to Render's `DATABASE_URL`). This was *reproduced concretely* in a 2026-10-14 session: a query that takes ~2.5-3.7s alone took 10-11.5s under 4 concurrent identical requests — exactly the kind of load a React StrictMode double-fetch (dev only) or real concurrent users (prod) can trigger. Worth prioritizing.
- **Exchange Online application access policy** — not yet confirmed applied; until it is, the email-sending Azure app can technically send as any tenant mailbox, not just the intended one. See `docs/email-m365-admin-handoff.md` step 5.
- **No real `security@adage-automation.com` mailbox yet** — `MAIL_FROM_ADDRESS` is a personal-address stand-in. Swap once the real mailbox exists.
- **OneDrive backup handoff** — mid-progress, see `docs/backup-onedrive-admin-handoff.md`.
- **Custom domain** — not yet set up for the deployed frontend/backend.

## Current major feature areas (brief map, not exhaustive)

- **Security tap-recording** (`SecurityHome`) — search → select → ENTRY/EXIT, duplicate-tap confirmation, offline IndexedDB queue with visible "pending sync" state.
- **Dashboard** — daily summary, filters, responsive table→card layout.
- **Employees** — CRUD, soft-deactivate, Excel import/export, car number field.
- **EmployeeDetails** — per-day movement view, on-demand email/PNG/PDF report.
- **Corrections** (shown to users as "Missing Movements") — fills in a genuinely missing ENTRY/EXIT only; cannot edit a record that already has a real value, not even to fix a wrong type/time. The old append-only "correct an existing record" capability was removed outright 2026-10-23, not just hidden — see `decisions.md`. Security and Admin both hold `CORRECT_RECORDS` as of 2026-10-26; HR does not. The submitted time also has to actually close the gap — a missing EXIT either after the day's last record (closing its trailing gap) or, when the day already has its own complete session, strictly before its first record (a separate, earlier shift crossing midnight — via the "Exit was after midnight" checkbox, 2026-10-30); a missing ENTRY always has to be before everything already recorded. Not just the right type — added 2026-10-28 after the one-tap `09:00` default was found capable of adding a record that left the day still broken; see `decisions.md`. An overnight-crossing shift, once added, is stitched across both days everywhere it's shown (this list, Insights' hours, and `EmployeeDetails`'s "Total working hours" banner) rather than leaving either day looking unresolved — three independent implementations of this, deliberately not shared across a NestJS service / a different NestJS service / frontend React code; see `decisions.md`.
- **Users / Roles / Audit Log / Settings** — admin-only management, full audit trail on writes.
- **Insights** (`Insights.tsx`, HR/Admin only, `VIEW_REPORTS` permission) — the most complex screen, read-only analytics computed live from `movement_records`. As of 2026-10-14 this includes: attendance/hours trend charts, a per-employee drill-down (daily duration + a company-wide "how this employee compares" distribution chart with click-through to see who's in a bucket), Department Comparison (three independent bar charts — Median Duration / Short-Duration % / Overtime %, each with its own sort and click-through to that department's employees, filterable by a department shortlist independent of the page's top Team filter), a Team Breakdown table, a Daily Roster modal, Excel exports throughout, and a **Days** filter (Without weekends / With weekends / Just weekends — weekdays-only is the default, since the whole analytics layer assumes a Mon-Fri work week unless told otherwise). Every drill-down and the Daily Roster modal reuse the same underlying aggregation helpers as the charts, so a drill-down can never disagree with the chart that opened it — this invariant is deliberate, preserve it if you extend Insights further.

## A pattern worth knowing before you touch `insights.service.ts`

Nearly every Insights number flows through one shared pipeline: `fetchMovements()` → (optionally) a day-scope filter → `buildEmployeeDayAggs()` → per-metric aggregation. Raw record views (Corrections, Dashboard's record table, per-employee movement history, and a few "raw" drill-down metrics like `attendance`/`unit`/`hour`/`corrected`) deliberately bypass this pipeline and always show literal taps regardless of filters — that split is intentional, not an inconsistency. If you're asked to change how a stat is computed, find the single aggregation point first rather than patching each chart's config individually; the codebase is written to make that possible.
