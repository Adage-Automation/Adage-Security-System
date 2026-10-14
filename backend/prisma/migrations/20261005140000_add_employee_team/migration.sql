-- Optional team/department field on employees, for the HR/Admin Insights
-- team-wise breakdown. Nullable, no default -- metadata-only on Postgres,
-- every existing row gets team = NULL, nothing rewritten. Validated
-- against a fixed list at the application layer (backend/src/common/
-- constants/teams.ts), not a DB enum/constraint, so the list can change
-- without another migration.
ALTER TABLE "employees" ADD COLUMN "team" TEXT;

CREATE INDEX "employees_team_idx" ON "employees"("team");
