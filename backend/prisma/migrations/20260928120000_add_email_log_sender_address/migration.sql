-- Records the mailbox actually used as the Graph API sender for an emailed
-- report, distinct from `cc` (the intended sending account) -- see
-- schema.prisma's comment on EmailLog.senderAddress and docs/decisions.md.
ALTER TABLE "email_logs" ADD COLUMN IF NOT EXISTS "sender_address" TEXT;
