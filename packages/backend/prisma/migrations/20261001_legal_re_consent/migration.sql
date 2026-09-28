-- Re-consent tracking for accounts that predate consent enforcement.
--
-- No consent is invented here. Backfilling a LegalAcceptance row for someone
-- who never signed would be a false record in an append-only evidence table and
-- would not actually bind them to the terms. Instead this table records the
-- moment each person was genuinely notified, which is the only defensible start
-- point for a grace period.
CREATE TABLE IF NOT EXISTS "LegalReConsent" (
    "userId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "graceDays" INTEGER NOT NULL DEFAULT 30,
    "reminders" INTEGER NOT NULL DEFAULT 0,
    "lastRemindedAt" TIMESTAMP(3),
    "satisfiedAt" TIMESTAMP(3),

    CONSTRAINT "LegalReConsent_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX IF NOT EXISTS "LegalReConsent_satisfiedAt_idx" ON "LegalReConsent"("satisfiedAt");
CREATE INDEX IF NOT EXISTS "LegalReConsent_notifiedAt_idx" ON "LegalReConsent"("notifiedAt");

DO $$ BEGIN
    ALTER TABLE "LegalReConsent" ADD CONSTRAINT "LegalReConsent_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
