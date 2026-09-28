-- Cashfree as an alternative payment provider.
--
-- Design note: razorpayOrderId becomes NULLABLE rather than being replaced.
-- Postgres allows many NULLs under a UNIQUE constraint, so existing Razorpay
-- rows keep their uniqueness guarantee while Cashfree-only orders can exist
-- alongside them. Dropping the column would also destroy the audit trail for
-- every payment already settled, which is not an acceptable trade for a
-- gateway migration.

-- PaymentOrder
ALTER TABLE "PaymentOrder" ALTER COLUMN "razorpayOrderId" DROP NOT NULL;
ALTER TABLE "PaymentOrder" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'razorpay';
ALTER TABLE "PaymentOrder" ADD COLUMN "cashfreeOrderId" TEXT;
ALTER TABLE "PaymentOrder" ADD COLUMN "cashfreePaymentId" TEXT;

CREATE UNIQUE INDEX "PaymentOrder_cashfreeOrderId_key" ON "PaymentOrder"("cashfreeOrderId");
CREATE UNIQUE INDEX "PaymentOrder_cashfreePaymentId_key" ON "PaymentOrder"("cashfreePaymentId");

-- Booking
ALTER TABLE "Booking" ADD COLUMN "paymentProvider" TEXT;
ALTER TABLE "Booking" ADD COLUMN "cashfreeOrderId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "cashfreePaymentId" TEXT;

-- Lookups for the settlement and webhook paths.
CREATE INDEX "PaymentOrder_cashfreeOrderId_idx" ON "PaymentOrder"("cashfreeOrderId");
CREATE INDEX "PaymentOrder_provider_idx" ON "PaymentOrder"("provider");
CREATE INDEX "Booking_cashfreeOrderId_idx" ON "Booking"("cashfreeOrderId");
