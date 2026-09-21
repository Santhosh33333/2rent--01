-- Event discovery rebuild: cover image, category, privacy, price + query indexes.
-- All statements idempotent (IF NOT EXISTS) so re-runs are safe.
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "privacy" TEXT NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "price" DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS "Event_status_startTime_idx" ON "Event"("status", "startTime");
CREATE INDEX IF NOT EXISTS "Event_category_idx" ON "Event"("category");
