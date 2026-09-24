-- Records, for migration-history purposes, a change that was already made
-- directly against the live database (2026-09-22) rather than through
-- Prisma: the phone/department/designation columns on employees were
-- never used anywhere (no UI ever exposed them, no report/email template
-- read them) and were dropped by hand in Supabase. schema.prisma,
-- backend/src/employees/dto/employee.dto.ts, backend/scripts/import-employees.ts,
-- and frontend/src/types.ts were updated to match in a separate commit.
--
-- Against the live database this is a genuine no-op (IF EXISTS makes it
-- safe even though the columns are already gone there). Its purpose is
-- solely to keep the migration HISTORY honest: without it, building a
-- brand-new database from scratch by replaying every migration in order
-- would still recreate these columns via 20260903103752_init, leaving a
-- fresh database subtly different from the live one (harmless — Prisma
-- Client never references them either way — but confusing to anyone
-- comparing the two). See docs/decisions.md.
ALTER TABLE "employees"
  DROP COLUMN IF EXISTS "phone",
  DROP COLUMN IF EXISTS "department",
  DROP COLUMN IF EXISTS "designation";
