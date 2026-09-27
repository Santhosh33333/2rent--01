-- Persist the caller's optimistic-message id so a refresh can reconcile the
-- placeholder bubble to the real row instead of rendering a duplicate.
-- Idempotent. Indexed for the (senderId, clientId) lookup the client uses.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
CREATE INDEX IF NOT EXISTS "Message_senderId_clientId_idx" ON "Message"("senderId", "clientId");
