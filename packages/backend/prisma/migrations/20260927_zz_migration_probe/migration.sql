-- TEMPORARY probe: proves the Docker CMD now applies pending migrations.
-- Reverted by the next migration in this same deploy.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "zzMigrationProbe" BOOLEAN NOT NULL DEFAULT false;
