-- Creator-chosen retention for music-room uploads.
--
-- A room can play our licensed catalogue, a host-supplied file, or a single
-- YouTube video. Only the host's *uploaded* file needs a lifetime: the
-- catalogue is shared and owned by us, and a link costs nothing to keep. So the
-- creator picks how many days an upload lives (`retentionDays`, 0 = keep until
-- the room ends), and `mediaExpiresAt` records when the current upload is due to
-- be purged.
--
-- Idempotent, like the migration that created the table: a database bootstrapped
-- with `prisma db push` already has these columns, and a failing migration stops
-- `prisma migrate deploy`, which stops the container booting.

ALTER TABLE "MusicRoom" ADD COLUMN IF NOT EXISTS "retentionDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MusicRoom" ADD COLUMN IF NOT EXISTS "mediaExpiresAt" TIMESTAMP(3);
