-- Bank statement reconciliation for manual UPI.
--
-- While online checkout is unavailable, a top-up is settled by a person paying a
-- UPI QR, typing a UTR, and an admin reading a bank statement to decide whether
-- that UTR is real. The reconciliation tables let the statement be uploaded and
-- each credit line matched back to the request that claimed it, so the admin
-- decides once per file instead of once per request.
--
-- Money invariants this schema is responsible for:
--
-- 1. A line can be credited at most once. BankStatement.fileHash is UNIQUE so
--    the same export cannot be uploaded twice and reprocessed, and
--    BankStatement.status gates the apply step so a second click on an applied
--    file is refused rather than settling the same rows twice.
-- 2. Matching is by (referenceNorm, amount), not by row id. referenceNorm is the
--    case- and whitespace-normalised UTR, indexed, because that is the lookup
--    the reconciler performs once per line.
-- 3. creditedAt is separate from matchStatus on purpose. "We found the request"
--    and "we moved the wallet" are different facts, and a crash between them must
--    be visible rather than collapsing into one status that lies about which
--    happened.

CREATE TABLE "BankStatement" (
    "id"              TEXT        NOT NULL,
    "fileName"        TEXT        NOT NULL,
    "byteSize"        INTEGER     NOT NULL DEFAULT 0,
    "fileHash"        TEXT        NOT NULL,
    "periodFrom"      TIMESTAMP(3),
    "periodTo"        TIMESTAMP(3),
    "rowCount"        INTEGER     NOT NULL DEFAULT 0,
    "matchedCount"    INTEGER     NOT NULL DEFAULT 0,
    "creditedCount"   INTEGER     NOT NULL DEFAULT 0,
    "unmatchedCount"  INTEGER     NOT NULL DEFAULT 0,
    "skippedAmount"   DECIMAL     NOT NULL DEFAULT 0,
    "status"          TEXT        NOT NULL DEFAULT 'UPLOADED',
    "columnMap"       TEXT,
    "warnings"        TEXT,
    "uploadedById"    TEXT,
    "appliedById"     TEXT,
    "appliedAt"       TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- Re-uploading the identical export is a no-op, not a second settlement pass.
CREATE UNIQUE INDEX "BankStatement_fileHash_key" ON "BankStatement"("fileHash");
CREATE INDEX "BankStatement_status_idx" ON "BankStatement"("status");
CREATE INDEX "BankStatement_createdAt_idx" ON "BankStatement"("createdAt");

CREATE TABLE "BankStatementRow" (
    "id"            TEXT        NOT NULL,
    "statementId"   TEXT        NOT NULL,
    "lineNo"        INTEGER     NOT NULL,
    "rawReference"  TEXT        NOT NULL,
    "rawAmount"     TEXT,
    "referenceNorm" TEXT        NOT NULL,
    "rawDate"       TEXT,
    "amount"        DECIMAL,
    "txnDate"       TIMESTAMP(3),
    "inbound"       BOOLEAN     NOT NULL DEFAULT true,
    "matchStatus"   TEXT        NOT NULL DEFAULT 'UNMATCHED',
    "matchReason"   TEXT,
    "matchedType"   TEXT,
    "matchedId"     TEXT,
    "matchedAmount" DECIMAL,
    "matchedUserId" TEXT,
    "creditedAt"    TIMESTAMP(3),
    "creditedById"  TEXT,
    "rawJson"       TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementRow_pkey" PRIMARY KEY ("id")
);

-- The per-line lookup the reconciler runs, and the admin's "show me only the
-- ones that need a human" filter.
CREATE INDEX "BankStatementRow_statementId_matchStatus_idx" ON "BankStatementRow"("statementId", "matchStatus");
CREATE INDEX "BankStatementRow_referenceNorm_idx" ON "BankStatementRow"("referenceNorm");

-- Points at whichever request a line settled, whichever kind it was. Not a
-- foreign key on purpose: a row must survive the request being deleted so the
-- audit trail of what was credited outlives the record it credited.
CREATE INDEX "BankStatementRow_matchedType_matchedId_idx" ON "BankStatementRow"("matchedType", "matchedId");

ALTER TABLE "BankStatement"
    ADD CONSTRAINT "BankStatement_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankStatement"
    ADD CONSTRAINT "BankStatement_appliedById_fkey"
    FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CASCADE, unlike the User links above: deleting a statement should take its
-- rows with it. They are only meaningful as the detail of that one file, and
-- orphans would make "every row of this statement" quietly return less than the
-- row count the summary claims.
ALTER TABLE "BankStatementRow"
    ADD CONSTRAINT "BankStatementRow_statementId_fkey"
    FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
