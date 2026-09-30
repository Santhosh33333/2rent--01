-- Admin-granted KYC trial.
--
-- A user may use the app without completing KYC while trialEndsAt is in the
-- future. Once it passes, the normal gate applies again. NULL (the default)
-- means no trial, so behaviour is unchanged for every existing row.
--
-- Stored on Verification rather than User because it is a property of the KYC
-- record, and requireKycVerified already reads that row.
ALTER TABLE "Verification" ADD COLUMN "trialEndsAt" TIMESTAMP(3);

-- Admin search lists users to pick from; supports filtering to trial users.
CREATE INDEX "Verification_trialEndsAt_idx" ON "Verification"("trialEndsAt");
