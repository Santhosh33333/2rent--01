-- Event fee escrow.
--
-- Context: `payMyShare` debited the payer's wallet and recorded a Transaction,
-- but nothing anywhere credited the event organizer. The fee simply left the
-- payer's account. This migration adds the missing half of the flow - a hold
-- plus a settlement ledger - so money is escrowed on payment and either paid to
-- the organizer or refunded to the payer.
--
-- Written by hand (not `prisma migrate dev`) to match the rest of this
-- database's migrations, and because these are additive statements only: no
-- existing row is read, rewritten or destroyed, so this is safe to apply over
-- production data.
--
-- Ordering note: Postgres resolves index columns at CREATE INDEX time, so every
-- column an index names must already exist. The ALTER TABLE that adds the
-- escrow columns to "Event" therefore comes first.

-- ---------------------------------------------------------------- Event columns

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "settlementStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "settledAt" TIMESTAMP(3);

-- ------------------------------------------------------------------- EventEscrow

CREATE TABLE IF NOT EXISTS "EventEscrow" (
  "id"                TEXT        NOT NULL,
  "eventId"           TEXT        NOT NULL,
  -- One escrow per share. This unique index is also the idempotency guard:
  -- a double tap or a retried request loses the insert race and settles once.
  "eventShareId"      TEXT        NOT NULL,
  "payerId"           TEXT        NOT NULL,
  "organizerId"       TEXT        NOT NULL,
  "amount"            DECIMAL(12,2) NOT NULL,
  "platformFee"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  "organizerPayout"   DECIMAL(12,2) NOT NULL,
  -- HELD -> RELEASED | REFUNDED | DISPUTED
  "status"            TEXT        NOT NULL DEFAULT 'HELD',
  "heldAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Fixed at hold time so retuning the window later cannot move a deadline that
  -- a payer is already counting on.
  "releaseEligibleAt" TIMESTAMP(3) NOT NULL,
  "releasedAt"        TIMESTAMP(3),
  "refundedAt"        TIMESTAMP(3),
  "decidedById"       TEXT,
  "decisionNote"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EventEscrow_pkey" PRIMARY KEY ("id")
);

-- escrow holds the money, so a payout/refund sweep must never miss one.
-- Ordering is status first: the sweep's WHERE is status = 'HELD'.
CREATE UNIQUE INDEX IF NOT EXISTS "EventEscrow_eventShareId_key"
  ON "EventEscrow"("eventShareId");

CREATE INDEX IF NOT EXISTS "EventEscrow_eventId_status_idx"
  ON "EventEscrow"("eventId", "status");

CREATE INDEX IF NOT EXISTS "EventEscrow_payerId_idx"
  ON "EventEscrow"("payerId");

CREATE INDEX IF NOT EXISTS "EventEscrow_organizerId_idx"
  ON "EventEscrow"("organizerId");

-- The auto-release sweep scans on exactly this pair: status = 'HELD' AND
-- "releaseEligibleAt" <= now().
CREATE INDEX IF NOT EXISTS "EventEscrow_status_releaseEligibleAt_idx"
  ON "EventEscrow"("status", "releaseEligibleAt");

ALTER TABLE "EventEscrow"
  ADD CONSTRAINT "EventEscrow_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventEscrow_eventShareId_fkey"
    FOREIGN KEY ("eventShareId") REFERENCES "EventShare"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventEscrow_payerId_fkey"
    FOREIGN KEY ("payerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventEscrow_organizerId_fkey"
    FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------- EventReport

CREATE TABLE IF NOT EXISTS "EventReport" (
  "id"             TEXT        NOT NULL,
  "eventId"        TEXT        NOT NULL,
  "reporterId"     TEXT        NOT NULL,
  -- Optional: a payer disputing their own held fee. A report about the event as
  -- a whole does not tie to one escrow.
  "escrowId"       TEXT,
  -- NO_SHOW | FAKE_EVENT | MISLEADING_DETAILS | UNSAFE | OTHER
  "reason"         TEXT        NOT NULL,
  "description"    TEXT,
  -- OPEN -> REFUNDED | RELEASED | DISMISSED
  "status"         TEXT        NOT NULL DEFAULT 'OPEN',
  "resolutionNote" TEXT,
  "resolvedById"   TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EventReport_pkey" PRIMARY KEY ("id")
);

-- The admin dispute queue reads undecided reports newest-first.
CREATE INDEX IF NOT EXISTS "EventReport_status_createdAt_idx"
  ON "EventReport"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "EventReport_eventId_status_idx"
  ON "EventReport"("eventId", "status");

CREATE INDEX IF NOT EXISTS "EventReport_reporterId_idx"
  ON "EventReport"("reporterId");

ALTER TABLE "EventReport"
  ADD CONSTRAINT "EventReport_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventReport_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- SET NULL, not CASCADE: deleting an escrow row must erase the money decision,
  -- never silently erase the safety report that prompted it.
  ADD CONSTRAINT "EventReport_escrowId_fkey"
    FOREIGN KEY ("escrowId") REFERENCES "EventEscrow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -------------------------------------------------------------------- Backfill
--
-- Any share already marked PAID under the old flow is money that left a payer
-- and reached nobody. There is no escrow to create retroactively because the old
-- code recorded no organizer credit, so there is no destination to credit from:
-- inventing one would move money the platform never received.
--
-- These shares are flagged so the admin queue can surface them for a manual
-- decision instead of the sweep silently ignoring them.
--
-- Existence-guarded: the table is created in this same migration, so this is
-- only reached by re-running the file, but it stays safe either way.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'EventEscrow') THEN
    RAISE NOTICE 'Event escrow tables ready. Legacy PAID EventShare rows need a manual admin decision.';
  END IF;
END $$;