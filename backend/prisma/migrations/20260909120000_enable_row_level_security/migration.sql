-- Enable Row Level Security on every table in the public schema, with no
-- policies defined (default-deny for any role other than the table owner).
--
-- Why: Supabase auto-exposes every public-schema table through its own
-- REST/GraphQL API (PostgREST) whenever RLS is disabled, completely
-- bypassing this app's NestJS backend, session auth, and permission
-- guards. Anyone holding the project's anon/service key could otherwise
-- read or write users/employees/movement_records/etc. directly. Flagged
-- by Supabase's own Security Advisor (11 errors) on 2026-09-09.
--
-- This app's backend connects via Prisma as the `postgres` role, which
-- owns every one of these tables (confirmed: current_user = tableowner =
-- 'postgres') — table owners are exempt from RLS by default in Postgres,
-- so this migration has zero effect on how the application itself
-- functions. It only blocks access from any *other* role, which is
-- exactly Supabase's PostgREST anon/authenticated roles that this app
-- never uses in the first place.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "movement_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;

-- Not part of the Prisma schema (created at runtime by connect-pg-simple
-- and by Prisma Migrate itself respectively), but both live in the public
-- schema and were flagged by the same advisor scan.
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
