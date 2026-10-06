-- Durable marker for the admin report emails.
--
-- The seven cadences (daily, weekly, monthly, quarterly, yearly, next-month and
-- tax) were previously guarded by an in-process Set, which is why a deploy
-- landing inside the one-hour send window re-sent that period's report, and why
-- two instances reaching the same midnight each sent their own copy.
--
-- The uniqueness below IS the guard. Two instances claiming the same period race
-- on this INSERT, the database picks one, and the loser gets a constraint
-- violation rather than a hopeful SELECT that said "not sent yet". That is the
-- difference between a check-then-act guard (a race) and a real one.
--
-- Idempotent by construction: CREATE TABLE IF NOT EXISTS plus a guarded index,
-- so a database that was bootstralled with `prisma db push` and already has the
-- table is left alone. Without the guard this fails, and a migration that fails
-- stops `prisma migrate deploy`, which stops the container booting.
CREATE TABLE IF NOT EXISTS "DigestRun" (
  "id" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "windowKey" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DigestRun_pkey" PRIMARY KEY ("id")
);

-- Unique on its own, so no separate CREATE UNIQUE INDEX is needed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'DigestRun' AND indexname = 'DigestRun_period_windowKey_key'
  ) THEN
    CREATE UNIQUE INDEX "DigestRun_period_windowKey_key"
      ON "DigestRun"("period", "windowKey");
  END IF;
END
$$;

-- Supports the prune that keeps this table from growing without bound: rows
-- older than a year describe periods that can never be due again.
CREATE INDEX IF NOT EXISTS "DigestRun_claimedAt_idx" ON "DigestRun"("claimedAt");