-- Self-service "forgot password" flow. Only the SHA-256 hash of the reset
-- token is stored, never the raw token, so a database leak alone can't be
-- used to complete a reset.
ALTER TABLE "users" ADD COLUMN "reset_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "reset_token_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_reset_token_hash_key" ON "users"("reset_token_hash");
