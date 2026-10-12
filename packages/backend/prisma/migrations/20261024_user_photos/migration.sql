-- Profile gallery: extra photos beyond the single User.avatarUrl.
--
-- Dating discovery shows these as a swipeable set, so `position` is explicit
-- rather than implied by createdAt. The row is owned by the user and removed
-- with them (ON DELETE CASCADE), matching how the rest of the profile data
-- behaves.
--
-- Idempotent for a database bootstrapped with `prisma db push`, which already
-- has the table. A failing migration stops `prisma migrate deploy`, which stops
-- the container booting, so the guards are deliberate.
CREATE TABLE IF NOT EXISTS "UserPhoto" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserPhoto_userId_position_idx" ON "UserPhoto"("userId", "position");

DO $$
BEGIN
  ALTER TABLE "UserPhoto"
    ADD CONSTRAINT "UserPhoto_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
