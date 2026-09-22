-- UPI payment screenshot proof. Idempotent.
ALTER TABLE "UpiPayment" ADD COLUMN IF NOT EXISTS "proofImageUrl" TEXT;
