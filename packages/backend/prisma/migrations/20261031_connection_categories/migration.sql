-- Live connection categories: DB-driven chat/call categories with per-mode
-- per-minute pricing. Purely additive — no existing table is touched, and the
-- read path falls back to built-in defaults while this table is empty.
-- Recovery: DROP TABLE "ConnectionCategory"; nothing else references it.

CREATE TABLE "ConnectionCategory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "callEnabled" BOOLEAN NOT NULL DEFAULT true,
    "videoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "chatPricePerMinute" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "callPricePerMinute" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "videoPricePerMinute" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectionCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectionCategory_key_key" ON "ConnectionCategory"("key");

CREATE INDEX "ConnectionCategory_enabled_sortOrder_idx" ON "ConnectionCategory"("enabled", "sortOrder");
