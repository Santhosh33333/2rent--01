-- Idempotency for gateway refunds only holds if the database rejects the second
-- claim. The previous migration created a plain index, so two concurrent
-- webhook deliveries both passed the existence check and both moved money.
--
-- NULLs are not treated as equal by a Postgres unique index, so legacy rows
-- without a gateway refund id are not collapsed together. The old non-unique
-- index is dropped because UNIQUE already serves that lookup.
DROP INDEX IF EXISTS "RefundLog_cashfreeRefundId_idx";

CREATE UNIQUE INDEX "RefundLog_cashfreeRefundId_key"
  ON "RefundLog"("cashfreeRefundId");