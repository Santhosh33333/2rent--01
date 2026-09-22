-- Chat replies + reactions. Idempotent. (No FK on replyToId here: the Prisma
-- relation resolves at query time; fresh databases get constraints from schema.)
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "replyToId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "reactions" JSONB;
CREATE INDEX IF NOT EXISTS "Message_replyToId_idx" ON "Message"("replyToId");
