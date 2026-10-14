-- Synchronized listening / watch-together rooms.
--
-- Media is always our own: a catalogue track or a host-supplied file, never a
-- YouTube page (YouTube forbids synchronising playback, which is exactly what
-- this table's isPlaying/positionSec/version columns exist to do).
--
-- positionSec is the playhead at `updatedAt` and version orders updates, so a
-- late broadcast cannot overwrite a newer one on a client.
--
-- Idempotent for a database bootstrapped with `prisma db push`, which already
-- has these tables. A failing migration stops `prisma migrate deploy`, which
-- stops the container booting, so the guards are deliberate.

CREATE TABLE IF NOT EXISTS "MusicRoom" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "hostId"      TEXT NOT NULL,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "mediaKind"   TEXT NOT NULL DEFAULT 'AUDIO',
  "mediaUrl"    TEXT,
  "mediaTitle"  TEXT,
  "isPlaying"   BOOLEAN NOT NULL DEFAULT false,
  "positionSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "version"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MusicRoomMember" (
  "id"       TEXT NOT NULL,
  "roomId"   TEXT NOT NULL,
  "userId"   TEXT NOT NULL,
  "role"     TEXT NOT NULL DEFAULT 'GUEST',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicRoomMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MusicRoom_code_key" ON "MusicRoom"("code");
CREATE INDEX IF NOT EXISTS "MusicRoom_hostId_idx" ON "MusicRoom"("hostId");
CREATE INDEX IF NOT EXISTS "MusicRoom_isActive_idx" ON "MusicRoom"("isActive");
CREATE INDEX IF NOT EXISTS "MusicRoomMember_userId_idx" ON "MusicRoomMember"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "MusicRoomMember_roomId_userId_key" ON "MusicRoomMember"("roomId", "userId");

DO $$
BEGIN
  ALTER TABLE "MusicRoom"
    ADD CONSTRAINT "MusicRoom_hostId_fkey"
    FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MusicRoomMember"
    ADD CONSTRAINT "MusicRoomMember_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "MusicRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MusicRoomMember"
    ADD CONSTRAINT "MusicRoomMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
