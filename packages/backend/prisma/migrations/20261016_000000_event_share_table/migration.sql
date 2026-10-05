-- The missing table behind event cost-sharing, plus the two Event columns the
-- cost-sheet code reads and writes.
--
-- Why this file exists, and why its timestamp is 20261016_000000:
--
--   `EventShare` is declared as a model in prisma/schema.prisma and is read and
--   written by live code (eventPaymentController.getEventCostSheet / setEventAmount
--   / waiveEventShare / payEventShare, and the escrow sweep). But NO migration
--   ever created the table. It appeared in local development only because
--   somebody ran `prisma db push` at some point, which writes straight to the
--   database and records nothing in prisma/migrations.
--
--   That made the drift invisible locally and fatal in production. The next
--   migration to touch it, 20261016_event_fee_escrow, adds
--
--       ADD CONSTRAINT "EventEscrow_eventShareId_fkey"
--         FOREIGN KEY ("eventShareId") REFERENCES "EventShare"("id") ...
--
--   and dies with 42P01 `relation "EventShare" does not exist`. Because the
--   Dockerfile CMD is `prisma migrate deploy && node dist/src/server.js`, the
--   `&&` means the failed migration stops the server from ever starting, so the
--   deploy ends in update_failed and the API goes down completely. It also
--   blocks 20261017 and 20261018 behind it, which is why three of six pending
--   migrations were recorded applied and then everything stopped.
--
--   `Event.paymentStatus` and `Event.paidAt` are the same bug with no failing
--   migration to hide it: eventPaymentService.ts selects and writes both, the
--   baseline never created them on "Event" (the baseline's paymentStatus belongs
--   to "Booking"), and no later migration adds them. Production's Event table has
--   neither column, so every /events/:id/cost-sheet call would have failed with
--   "column Event.paymentStatus does not exist" even after the escrow tables were
--   in place. Prisma's own `migrate diff` against production flags all three.
--
--   This directory is named to sort BEFORE 20261016_event_fee_escrow, because
--   `prisma migrate deploy` applies migrations in lexicographic name order and
--   the escrow migration's foreign key needs this table to already exist. Prisma
--   reads the ordering from the directory name and does not care that the file
--   was authored later than its neighbour.
--
-- Every statement is additive and IF NOT EXISTS / existence-guarded, so this is
-- safe to apply over production data and a no-op on any environment that already
-- has the objects from an earlier `db push`.
--
-- Not fixed here, deliberately: the same `migrate diff` reports drifted indexes,
-- missing foreign keys and DECIMAL type mismatches on unrelated tables
-- (Booking_cashfreeOrderId_idx, Message_replyToId_fkey, PaymentOrder.refundedAmount
-- and others). None of those stop a deploy or a query, and rewriting column types
-- on live money tables during an outage recovery is the wrong risk to take. They
-- are a separate change.

-- ------------------------------------------------------- EventShare (missing)

CREATE TABLE IF NOT EXISTS "EventShare" (
  "id"        TEXT          NOT NULL,
  "eventId"   TEXT          NOT NULL,
  "userId"    TEXT          NOT NULL,
  -- What THIS attendee owes. Decimal, not Float: Event.price is advisory display
  -- data, but the amount charged and the amount collected must not drift by a
  -- rounding error.
  "amount"    DECIMAL(12,2) NOT NULL,
  -- PENDING | PAID | WAIVED
  "status"    TEXT          NOT NULL DEFAULT 'PENDING',
  -- WALLET (paid in-app) or UPI (paid straight to the organizer). A UPI payment
  -- is a claim until the organizer confirms it landed.
  "method"    TEXT          NOT NULL DEFAULT 'WALLET',
  -- The UPI reference the payer quoted, for the organizer to match.
  "methodRef" TEXT,
  -- SELF, or the id of whoever covered this share for someone else. Kept so
  -- "who actually paid" stays answerable after a group settle.
  "paidBy"    TEXT,
  "paidAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- No default: Prisma's @updatedAt is client-side, and a database default here
  -- would show up as drift against the schema.
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventShare_pkey" PRIMARY KEY ("id")
);

-- One share per person per event. This is what stops a second "invite" for the
-- same person creating a second bill for them.
CREATE UNIQUE INDEX IF NOT EXISTS "EventShare_eventId_userId_key"
  ON "EventShare"("eventId", "userId");

CREATE INDEX IF NOT EXISTS "EventShare_eventId_idx"
  ON "EventShare"("eventId");

CREATE INDEX IF NOT EXISTS "EventShare_userId_idx"
  ON "EventShare"("userId");

-- Existence-guarded rather than plain ADD CONSTRAINT: an environment that already
-- has the table from `db push` already has these constraints, and re-adding them
-- would abort this migration with 42710.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventShare_eventId_fkey') THEN
    ALTER TABLE "EventShare"
      ADD CONSTRAINT "EventShare_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventShare_userId_fkey') THEN
    ALTER TABLE "EventShare"
      ADD CONSTRAINT "EventShare_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ------------------------------------------- Event cost columns (also missing)
--
-- OPEN | PAID. Separate from settlementStatus, which the escrow migration adds:
-- this only means "collection is closed", settlementStatus tracks whether the
-- held money has been released or refunded.

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);