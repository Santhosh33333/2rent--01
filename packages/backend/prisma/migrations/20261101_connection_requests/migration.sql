-- Connection request lifecycle: a user searches for a connection (category +
-- chat/call/video). Eligible partners are notified, the first to accept wins,
-- the rest are told it is gone, and an unanswered request expires. This is the
-- connection-system replacement for the booking flow and is deliberately a
-- separate pair of tables: a ConnectionRequest is not a Booking.
--
-- Two tables, mirroring the existing Booking + DispatchRequest pair:
--   * ConnectionRequest          — the request itself (one per user search)
--   * ConnectionRequestRecipient — one row per notified partner, so a decline
--                                  is recorded per partner without killing a
--                                  request the other partners can still accept.
--
-- Purely additive. No existing table is created, altered or dropped.
-- Recovery: DROP TABLE "ConnectionRequestRecipient"; then
--           DROP TABLE "ConnectionRequest"; nothing else references them.

CREATE TABLE "ConnectionRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SEARCHING',
    "partnerId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pricePerMinute" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 10,
    "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "connectedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectionRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConnectionRequestRecipient" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ConnectionRequestRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConnectionRequest_requesterId_status_createdAt_idx" ON "ConnectionRequest"("requesterId", "status", "createdAt");
CREATE INDEX "ConnectionRequest_partnerId_status_createdAt_idx" ON "ConnectionRequest"("partnerId", "status", "createdAt");
CREATE INDEX "ConnectionRequest_status_expiresAt_idx" ON "ConnectionRequest"("status", "expiresAt");
CREATE UNIQUE INDEX "ConnectionRequestRecipient_requestId_partnerId_key" ON "ConnectionRequestRecipient"("requestId", "partnerId");
CREATE INDEX "ConnectionRequestRecipient_partnerId_status_idx" ON "ConnectionRequestRecipient"("partnerId", "status");

ALTER TABLE "ConnectionRequest" ADD CONSTRAINT "ConnectionRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConnectionRequest" ADD CONSTRAINT "ConnectionRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConnectionRequestRecipient" ADD CONSTRAINT "ConnectionRequestRecipient_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ConnectionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConnectionRequestRecipient" ADD CONSTRAINT "ConnectionRequestRecipient_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
