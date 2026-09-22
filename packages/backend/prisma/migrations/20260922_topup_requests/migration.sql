-- Manual-UPI wallet top-ups (no booking attached). Idempotent.
CREATE TABLE IF NOT EXISTS "TopupRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "referenceNumber" TEXT NOT NULL,
    "proofImageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'VERIFICATION_PENDING',
    "verifiedByAdminId" TEXT,
    "verificationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopupRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TopupRequest_referenceNumber_key" ON "TopupRequest"("referenceNumber");
CREATE INDEX IF NOT EXISTS "TopupRequest_status_idx" ON "TopupRequest"("status");
CREATE INDEX IF NOT EXISTS "TopupRequest_userId_idx" ON "TopupRequest"("userId");
