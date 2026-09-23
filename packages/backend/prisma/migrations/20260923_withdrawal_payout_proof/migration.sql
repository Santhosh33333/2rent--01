-- Admin proof-of-payout for approved withdrawals (e.g. screenshot of the
-- transfer). Idempotent: only adds a column.
ALTER TABLE "WithdrawalRequest" ADD COLUMN IF NOT EXISTS "payoutProofImageUrl" TEXT;