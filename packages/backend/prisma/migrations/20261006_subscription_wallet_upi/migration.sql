-- Subscriptions paid from the wallet, or by manual UPI when the wallet is short.
--
-- Two parts:
--   1. "SubscriptionPayment" - one manual-UPI collection request per plan. The
--      money buys the billing period, it is NOT a wallet top-up, so it is a
--      separate table rather than a TopupRequest (which credits spendable
--      balance).
--   2. Subscription columns the collection logic needs: autoRenew so a lapsing
--      plan is never charged after the user stopped auto-renewing, and pastDueAt
--      so an admin can see what is owed and since when.
--
-- Every identifier here is TEXT, not UUID. Subscription.id and User.id are both
-- text in this database, and a uuid column would silently fail the foreign keys.
--
-- Idempotent throughout, so re-running it where a previous attempt partially
-- applied cannot fail the deploy that runs `prisma migrate deploy`.

-- ---------------------------------------------------------------------------
-- 1. Subscription columns
-- ---------------------------------------------------------------------------
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "autoRenew" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "pastDueAt" TIMESTAMP(3);

-- The sweeper looks for "autoRenew AND active AND due" on every tick. Without
-- this it degrades into a sequential scan of every subscription ever created.
CREATE INDEX IF NOT EXISTS "Subscription_autoRenew_status_nextBillingAt_idx"
  ON "Subscription" ("autoRenew", "status", "nextBillingAt");

-- ---------------------------------------------------------------------------
-- 2. SubscriptionPayment
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SubscriptionPayment" (
  "id"                TEXT NOT NULL,
  "subscriptionId"    TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "planId"            TEXT NOT NULL,
  "amount"            DECIMAL(10,2) NOT NULL,
  "currency"          TEXT NOT NULL DEFAULT 'INR',
  "periodStart"       TIMESTAMP(3) NOT NULL,
  "periodEnd"         TIMESTAMP(3) NOT NULL,
  "referenceNumber"   TEXT,
  "proofImageUrl"     TEXT,
  "status"            TEXT NOT NULL DEFAULT 'VERIFICATION_PENDING',
  "verifiedByAdminId" TEXT,
  "verificationNote"  TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- One live collection request per subscription. Without this, a double-tap on
-- Subscribe (or a retry after a timeout) raises a second request for the same
-- period, and an admin could verify - and be paid for - both.
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPayment_subscriptionId_key"
  ON "SubscriptionPayment" ("subscriptionId");

-- Unique UTR. Enforced again in code against TopupRequest and UpiPayment, but one
-- bank line must not be able to settle two requests even if that check is
-- ever bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPayment_referenceNumber_key"
  ON "SubscriptionPayment" ("referenceNumber");

CREATE INDEX IF NOT EXISTS "SubscriptionPayment_status_idx"
  ON "SubscriptionPayment" ("status");

CREATE INDEX IF NOT EXISTS "SubscriptionPayment_userId_idx"
  ON "SubscriptionPayment" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionPayment_subscriptionId_fkey'
  ) THEN
    ALTER TABLE "SubscriptionPayment"
      ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionPayment_userId_fkey'
  ) THEN
    ALTER TABLE "SubscriptionPayment"
      ADD CONSTRAINT "SubscriptionPayment_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;