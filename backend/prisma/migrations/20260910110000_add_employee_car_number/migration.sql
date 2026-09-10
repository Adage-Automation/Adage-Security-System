-- Optional car number field on employees, searchable the same way as
-- name/code/email. No data backfilled -- most employees don't have this
-- on file yet; it's filled in over time via the Employees admin screen or
-- a future CSV import.
ALTER TABLE "employees" ADD COLUMN "car_number" TEXT;

CREATE INDEX "employees_car_number_idx" ON "employees"("car_number");
