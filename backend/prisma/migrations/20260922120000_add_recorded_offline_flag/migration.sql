-- Flags a movement record as having its movementAt taken from the guard's
-- device (offline-queue sync) rather than the server clock at creation
-- time. Defaults false so every existing row (all server-timestamped)
-- reads correctly with no backfill needed. See docs/decisions.md.
ALTER TABLE "movement_records" ADD COLUMN "recorded_offline" BOOLEAN NOT NULL DEFAULT false;
