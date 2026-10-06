-- New-user offer pricing on subscription plans.
--
-- Three numbers now describe a plan instead of one:
--
--   price      what a subscriber pays for a period (unchanged)
--   listPrice  the struck-through "was" price drawn beside an offer
--   offerPrice what a first-ever subscriber pays for their first period
--
-- Both new columns are nullable on purpose. Null is a real, meaningful state:
-- it means "no offer is being advertised here", and that is the honest default.
-- A discount the product cannot grant must not be drawn, so a plan only shows a
-- strike-through once an admin has actually configured one.
--
-- Nullable columns added without defaults need no table rewrite and no backfill,
-- so this applies instantly on a table that already carries live plans. The
-- guards make it idempotent for a database bootstrapped with `prisma db push`,
-- which already has them; a migration that fails stops `prisma migrate deploy`,
-- which stops the container booting.
ALTER TABLE "SubscriptionPlan"
  ADD COLUMN IF NOT EXISTS "listPrice" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "offerPrice" DOUBLE PRECISION;
