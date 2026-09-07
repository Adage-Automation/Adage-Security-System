# Running the App Locally

This machine's setup is already done (Supabase provisioned, migrated, seeded — see [decisions.md](./decisions.md#database-provider-supabase-mumbai) and the CHANGELOG's "First live database run" entry). This doc is the quick reference for starting/stopping both servers day to day. For first-time setup from scratch on a *new* machine, use [developer-guide.md](./developer-guide.md) instead.

## Prerequisites (already satisfied on this machine)

- `backend/.env` exists with a working `DATABASE_URL` pointed at the Supabase pooler connection (`aws-0-ap-south-1.pooler.supabase.com:5432`, not the direct `db.<ref>.supabase.co` host — that one is IPv6-only and unreachable from this network) and a `SESSION_SECRET`.
- Database schema is migrated and seeded.

## Start both servers

Open two terminals.

**Terminal 1 — backend:**
```bash
cd backend
npm run start:dev
```
Runs on `http://localhost:4000`, API at `http://localhost:4000/api`. Watches for file changes and recompiles automatically. Wait for `Adage Security System backend listening on port 4000` before using it — first boot after a fresh install/migration can take ~15-20 seconds.

**Terminal 2 — frontend:**
```bash
cd frontend
npm run dev
```
Runs on `http://localhost:5173`, proxies `/api/*` requests to the backend automatically (see `frontend/vite.config.ts`).

Open **http://localhost:5173** in a browser.

## Log in

Use one of the seeded dev accounts (see `backend/prisma/seed.ts` — passwords are dev-only, never reused anywhere real):

| Username | Password | Role |
|---|---|---|
| `admin` | `ChangeMe123!` | ADMIN |
| `hr` | `ChangeMe123!` | HR |
| `security` | `ChangeMe123!` | SECURITY |

Roles now have different access (see [decisions.md](./decisions.md)): `security` and `hr` can both search an employee and tap ENTRY/EXIT, then visit the Dashboard; only `hr` and `admin` can also reach the Employees screen; only `admin` can reach Users, Corrections, Audit Log, and Settings.

## Stopping

`Ctrl+C` in each terminal. Nothing else to clean up — the dev servers don't leave background processes.

## If something won't start

| Symptom | Fix |
|---|---|
| Backend hangs on `EADDRINUSE: address already in use :::4000` | Something is already listening on port 4000 — either a previous `npm run start:dev` wasn't stopped, or another app is using it. Find and stop it, or change `PORT` in `backend/.env`. |
| Login returns 200 but you're immediately logged out on the next request | This was a real bug (session never established) — fixed in `backend/src/auth/local-auth.guard.ts`. If you see it again, check that fix hasn't regressed. |
| `EADDRINUSE` aside, backend takes a long time to become reachable after starting | Normal on first boot after a fresh `npm install` (TypeScript compiles in watch mode) or the very first request after a cold Supabase connection (the pooled connection and the `connect-pg-simple` session table both need to initialize) — give it ~15-20 seconds. |
| Backend throws `P1001: Can't reach database server` | You're using the direct connection host (`db.<ref>.supabase.co:5432`) instead of the pooler (`aws-0-<region>.pooler.supabase.com:5432`) — see [deployment.md](./deployment.md#setting-up-supabase). |
| Frontend loads but every API call fails | Confirm the backend terminal shows `listening on port 4000` — the frontend's dev proxy silently fails if nothing's there to proxy to. |

## What's running where (recap)

| | URL | Notes |
|---|---|---|
| Frontend (PWA) | http://localhost:5173 | React + Vite dev server, hot-reloads on save |
| Backend API | http://localhost:4000/api | NestJS, `--watch` mode, hot-reloads on save |
| Database | Supabase, Mumbai (ap-south-1) | Remote — not running locally; both servers above talk to it over the network |
