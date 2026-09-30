-- Metered call billing: a held-balance reservation and a per-call charge record.
--
-- Wallet.heldBalance is money reserved for a call in progress. It is NOT a
-- second balance: available = balance - heldBalance, and nothing outside the
-- call-billing service may spend it.
--
-- CallCharge is one row per connected call, created when the call is answered
-- and settled exactly once (HELD -> CHARGED or HELD -> RELEASED). The unique
-- index on callId is what makes settlement idempotent, so a duplicate end event
-- cannot double-charge or double-refund.
--
-- Scope note: this migration is intentionally limited to the two models this
-- feature needs. The local database has pre-existing drift against schema.prisma
-- (extra indexes, missing foreign keys, missing updatedAt defaults) which a
-- wholesale `migrate diff` would sweep in. Those are unrelated to call billing
-- and re-validating foreign keys on populated tables takes heavy locks, so they
-- are deliberately left for a separate, reviewed migration.

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "heldBalance" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CallCharge" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "ratePerMinute" DECIMAL(10,2) NOT NULL,
    "heldAmount" DECIMAL(10,2) NOT NULL,
    "chargedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "billableSeconds" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallCharge_callId_key" ON "CallCharge"("callId");

-- CreateIndex
CREATE INDEX "CallCharge_callerId_createdAt_idx" ON "CallCharge"("callerId", "createdAt");

-- CreateIndex
CREATE INDEX "CallCharge_status_idx" ON "CallCharge"("status");

-- CreateIndex
CREATE INDEX "CallCharge_walletId_idx" ON "CallCharge"("walletId");

-- Supports the reconciliation sweep that finds HELD rows with no matching
-- endedAt, i.e. calls whose settlement was lost to a crash or deploy.
CREATE INDEX "CallLog_status_startedAt_idx" ON "CallLog"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "CallCharge" ADD CONSTRAINT "CallCharge_callId_fkey" FOREIGN KEY ("callId") REFERENCES "CallLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallCharge" ADD CONSTRAINT "CallCharge_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
