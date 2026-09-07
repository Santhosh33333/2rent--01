-- CreateTable (idempotent: this migration was once recorded as applied without
-- the DDL executing, so the same SQL may be re-run after boot-time recovery.
-- IF NOT EXISTS makes execution safe on both fresh and existing databases.)
CREATE TABLE IF NOT EXISTS "UploadedFile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UploadedFile_key_key" ON "UploadedFile"("key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UploadedFile_createdAt_idx" ON "UploadedFile"("createdAt");