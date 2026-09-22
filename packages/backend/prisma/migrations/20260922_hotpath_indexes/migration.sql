-- Hot-path query indexes for 1000-user throughput. All idempotent.
CREATE INDEX IF NOT EXISTS "Booking_userId_status_idx" ON "Booking"("userId", "status");
CREATE INDEX IF NOT EXISTS "Booking_partnerId_status_idx" ON "Booking"("partnerId", "status");
CREATE INDEX IF NOT EXISTS "Booking_status_scheduledAt_idx" ON "Booking"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "BookingTimeout_isProcessed_timeoutAt_idx" ON "BookingTimeout"("isProcessed", "timeoutAt");
