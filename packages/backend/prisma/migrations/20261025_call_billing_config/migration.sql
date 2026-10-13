-- Call billing, editable from Admin -> Pricing & Fees.
--
-- These are ordinary PricingConfig rows, so no admin UI change is needed: the
-- Pricing screen already lists and edits every row it finds. Seeding them
-- explicitly means the knobs are visible and editable instead of existing only
-- as code fallbacks that an admin cannot discover.
--
--   CALL_BILLING_ENABLED       0 = calls are free (default), 1 = metered per minute
--   CALL_RATE_PER_MINUTE       rupees charged per started minute
--   CALL_MAX_BILLABLE_MINUTES  ceiling on one call; also the up-front reservation
--                              the caller must be able to cover before ringing
--
-- ON CONFLICT DO NOTHING keeps this idempotent for a database already
-- bootstrapped with `prisma db push`, and leaves any value an admin has already
-- set untouched. Ids are literals because the column has no database-level
-- default (Prisma supplies uuid() on insert).
INSERT INTO "PricingConfig" ("id", "key", "value", "description", "category", "isActive", "createdAt", "updatedAt")
VALUES
  ('4f3c1b2a-9d10-4c21-8e34-000000000001', 'CALL_BILLING_ENABLED', '0',
   'Charge per minute for in-app calls. 0 = calls are free.', 'GENERAL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('4f3c1b2a-9d10-4c21-8e34-000000000002', 'CALL_RATE_PER_MINUTE', '1',
   'Rupees charged per started minute of an in-app call.', 'GENERAL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('4f3c1b2a-9d10-4c21-8e34-000000000003', 'CALL_MAX_BILLABLE_MINUTES', '60',
   'Maximum minutes one call may be charged for; also the amount reserved up front.', 'GENERAL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
