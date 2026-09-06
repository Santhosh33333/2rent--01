-- Chat media + booking linkage (spec 103).
-- messageType: TEXT | IMAGE | VOICE | SYSTEM. mediaUrl points at a file
-- served through the authenticated media endpoint (never public static).
-- bookingId links booking-scoped threads (no FK: bookings may be removed
-- while chat history is retained for safety/audit).

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "messageType" TEXT NOT NULL DEFAULT 'TEXT';
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "bookingId" TEXT;

CREATE INDEX IF NOT EXISTS "Message_bookingId_idx" ON "Message"("bookingId");
