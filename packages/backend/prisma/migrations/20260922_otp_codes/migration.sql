-- Secure OTP records (hashed, purpose-bound, attempt-limited). Idempotent.
CREATE TABLE IF NOT EXISTS "OtpCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "identifier" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "requestIp" TEXT,
    "userAgent" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "deliveryStatus" TEXT,
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OtpCode_identifier_purpose_status_idx" ON "OtpCode"("identifier", "purpose", "status");
CREATE INDEX IF NOT EXISTS "OtpCode_createdAt_idx" ON "OtpCode"("createdAt");
CREATE INDEX IF NOT EXISTS "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");
