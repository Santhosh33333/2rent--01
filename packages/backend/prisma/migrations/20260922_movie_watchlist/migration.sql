-- Saved movies. Idempotent.
CREATE TABLE IF NOT EXISTS "MovieWatchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "posterUrl" TEXT,
    "releaseDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MovieWatchlist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MovieWatchlist_userId_tmdbId_key" ON "MovieWatchlist"("userId", "tmdbId");
CREATE INDEX IF NOT EXISTS "MovieWatchlist_userId_idx" ON "MovieWatchlist"("userId");
