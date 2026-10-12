-- Per-account first-period discount.
--
-- The plan-level offer (SubscriptionPlan.offerPrice) is the same deal for every
-- new account. This is the targeted counterpart: an admin can give ONE account a
-- discount without changing what everyone else sees.
--
-- Stored as a percent rather than an absolute amount so the same grant applies
-- sensibly to whichever plan the account picks (a flat Rs.9 off a yearly plan
-- would be meaningless). customOfferUntil is optional; null means "no expiry".
--
-- All three columns are nullable, and nullable columns added without defaults
-- need no rewrite or backfill, so this applies instantly on the live User table.
-- The guards make it idempotent for a database bootstrapped with `prisma db
-- push`, which already has them; a failing migration stops `prisma migrate
-- deploy`, which stops the container booting.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "customOfferPercent" INTEGER,
  ADD COLUMN IF NOT EXISTS "customOfferNote" TEXT,
  ADD COLUMN IF NOT EXISTS "customOfferUntil" TIMESTAMP(3);
