-- Sports/movies sub-filtering (e.g. cricket, football, action). Idempotent.
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "subcategory" TEXT;
CREATE INDEX IF NOT EXISTS "Event_category_subcategory_idx" ON "Event"("category", "subcategory");
