-- Refunds for wallet top-ups, and a locally-computed access window.
--
-- Two problems this fixes:
--
-- 1. Refunds were dropped on the floor. The one-off payment webhook had no
--    REFUNDS/REFUND/AUTO_REFUND branch, so a refund issued from the Cashfree
--    dashboard left our order COMPLETED and the wallet credited. Nothing called
--    refundEngine either, and that engine is booking-shaped. RefundLog exists
--    but has no relation to PaymentOrder and required a bookingId, so a wallet
--    top-up refund had nowhere to be recorded. bookingId becomes nullable and
--    paymentOrderId is added; cashfreeRefundId is indexed because it is the
--    idempotency key for redeliveries.
--
-- 2. Access depended on a Cashfree subscription webhook that cannot be
--    registered until Subscriptions is activated on the merchant account.
--    hasActiveSubscription() counted ACTIVE Subscription rows, which only the
--    gateway creates, so nobody qualified. User.accessUntil is a plain local
--    timestamp: a settled top-up grants a window, the window expires by
--    comparison, and no provider round-trip is involved.

ALTER TABLE "RefundLog" ALTER COLUMN "bookingId" DROP NOT NULL;
ALTER TABLE "RefundLog" ADD COLUMN "paymentOrderId" TEXT;

CREATE INDEX "RefundLog_paymentOrderId_idx" ON "RefundLog"("paymentOrderId");
CREATE INDEX "RefundLog_cashfreeRefundId_idx" ON "RefundLog"("cashfreeRefundId");

ALTER TABLE "User" ADD COLUMN "accessUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "accessSource" TEXT;

CREATE INDEX "User_accessUntil_idx" ON "User"("accessUntil");

-- PaymentOrder needs a REFUNDED state that the settlement latch can see. It is
-- a string column, so this is data-only bookkeeping for the refund path.
ALTER TABLE "PaymentOrder" ADD COLUMN "refundedAmount" DECIMAL;
ALTER TABLE "PaymentOrder" ADD COLUMN "refundedAt" TIMESTAMP(3);