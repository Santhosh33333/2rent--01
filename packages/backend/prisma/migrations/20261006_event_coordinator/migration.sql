-- Movie outings: one person is added to the event who does NOT buy a seat, and
-- that person is the one who confirms the group's booking (the coordinator /
-- point of contact). Name + phone only - deliberately not a User FK, because
-- the coordinator may not have a Nabri account and forcing a join would defeat
-- "added to the event, not booking".
--
-- Additive only, matching the 20260930_event_movie_fields style. IF NOT EXISTS
-- keeps it idempotent against the boot-time schema reconciliation in src/server.ts.
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "coordinatorName" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "coordinatorPhone" TEXT;