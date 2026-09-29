-- Remove the retired Razorpay gateway.
--
-- Safe to run: production held no completed Razorpay payment. The single row
-- carrying a razorpay_order_id was an abandoned checkout (PAYMENT_INITIATED,
-- no payment id, no signature, no refund), so no money or refund reference is
-- lost by dropping these columns.
--
-- The provider columns on PaymentOrder and Booking are kept: they record which
-- gateway actually settled a row, which is still worth knowing.

ALTER TABLE "PaymentOrder" DROP COLUMN IF EXISTS "razorpayOrderId";
ALTER TABLE "PaymentOrder" DROP COLUMN IF EXISTS "razorpayPaymentId";

ALTER TABLE "Booking" DROP COLUMN IF EXISTS "razorpayOrderId";
ALTER TABLE "Booking" DROP COLUMN IF EXISTS "razorpayPaymentId";
ALTER TABLE "Booking" DROP COLUMN IF EXISTS "razorpaySignature";

ALTER TABLE "RefundLog" DROP COLUMN IF EXISTS "razorpayRefundId";
ALTER TABLE "RefundLog" ADD COLUMN IF NOT EXISTS "cashfreeRefundId" TEXT;

-- Every remaining order is a Cashfree order. Anything left marked razorpay was
-- never settled, so it is relabelled rather than left pointing at a gateway
-- that no longer exists.
UPDATE "PaymentOrder" SET "provider" = 'cashfree' WHERE "provider" IS NULL OR "provider" <> 'cashfree';
UPDATE "Booking" SET "paymentProvider" = 'cashfree' WHERE "paymentProvider" IS NULL OR "paymentProvider" <> 'cashfree';

ALTER TABLE "PaymentOrder" ALTER COLUMN "provider" SET DEFAULT 'cashfree';
