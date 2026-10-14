-- The official "Nabri Community".
--
-- `Community.isOfficial` marks the single community every account is
-- auto-joined to. It is read-only for regular members: only SUPER_ADMIN/ADMIN
-- accounts may post there. Existing users are joined lazily on read; new
-- accounts are joined at registration (services/officialCommunity.ts).
--
-- `CommunityPost.isPinned` floats the built-in welcome post to the top of the
-- official community.
--
-- Idempotent, like the retention migration: a database bootstrapped with
-- `prisma db push` already has these columns, and a failing migration stops
-- `prisma migrate deploy`, which stops the container booting.

ALTER TABLE "Community" ADD COLUMN IF NOT EXISTS "isOfficial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CommunityPost" ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Community_isOfficial_idx" ON "Community"("isOfficial");
