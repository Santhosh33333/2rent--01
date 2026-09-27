-- Versioned legal documents and signed consent records.
--
-- LegalDocument is the versioned master copy: a wording change is a NEW row
-- with the previous one flipped to isCurrent=false. That is what lets an old
-- acceptance keep pointing at the exact text the person signed, and lets a
-- material change require re-consent instead of rewriting history.
--
-- contentSha256 seals the signed text: if the stored HTML is ever edited after
-- the fact, the hash no longer matches and tampering is detectable.

CREATE TABLE IF NOT EXISTS "LegalDocument" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "contentHtml" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- One current row per kind, but many versions of a kind may exist.
CREATE UNIQUE INDEX IF NOT EXISTS "LegalDocument_kind_version_key" ON "LegalDocument"("kind", "version");
CREATE INDEX IF NOT EXISTS "LegalDocument_kind_isCurrent_idx" ON "LegalDocument"("kind", "isCurrent");

CREATE TABLE IF NOT EXISTS "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "consentType" TEXT NOT NULL DEFAULT 'SIGNUP',
    "signatureType" TEXT NOT NULL DEFAULT 'TYPED_NAME',
    "signatureValue" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LegalAcceptance_userId_kind_idx" ON "LegalAcceptance"("userId", "kind");
CREATE INDEX IF NOT EXISTS "LegalAcceptance_kind_version_idx" ON "LegalAcceptance"("kind", "version");
CREATE INDEX IF NOT EXISTS "LegalAcceptance_userId_withdrawnAt_idx" ON "LegalAcceptance"("userId", "withdrawnAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"LegalAcceptance"'::regclass AND conname = 'LegalAcceptance_userId_fkey') THEN
        ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"LegalAcceptance"'::regclass AND conname = 'LegalAcceptance_documentId_fkey') THEN
        ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_documentId_fkey"
            FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
