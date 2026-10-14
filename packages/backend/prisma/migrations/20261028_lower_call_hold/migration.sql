-- Lower the seeded up-front call reservation from 60 minutes to 20.
--
-- CALL_MAX_BILLABLE_MINUTES is both the ceiling on a single call and the amount
-- reserved from the caller's wallet when it connects (rate * minutes). At the
-- default rate of 1/minute the old value withheld 60 up front, which is a lot to
-- hold for a first call.
--
-- Guarded on value = '60' so it only rewrites the untouched seed. An admin who
-- has deliberately set this in Admin -> Pricing & Fees keeps their choice, and a
-- re-run is a no-op. New databases get 20 from the code default in
-- callBillingService as well as from the seed here.
UPDATE "PricingConfig"
SET "value" = '20', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'CALL_MAX_BILLABLE_MINUTES' AND "value" = '60';
