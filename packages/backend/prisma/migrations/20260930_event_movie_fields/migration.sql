-- Movie outings: cinema trips are events, but they need a flag to drive a
-- distinct creation flow and card treatment, the chosen theatre (a venue is not
-- an address - two branches of the same mall share a map pin), and an optional
-- external booking link for organizers who would rather take payment elsewhere.
--
-- Deliberately minimal. The movie name is `title` and the showtime is
-- `startTime`; adding a second column for either would create two sources of
-- truth that can silently disagree.
--
-- Additive only, and deliberately NOT reconciling the pre-existing drift
-- between this database and schema.prisma. That drift is a separate review with
-- its own lock and backfill risk, and folding it in here would make a one-column
-- change carry the weight of an unrelated 10-FK / 8-index migration.
--
-- IF NOT EXISTS matches the idempotent style already used by the boot-time
-- schema reconciliation in src/server.ts, so a deploy that reconciles before
-- this migration runs cannot collide with it.
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "isMovie" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "theatreName" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "bookingUrl" TEXT;
