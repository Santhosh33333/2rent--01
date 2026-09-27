-- Removes the probe column added by 20260927_zz_migration_probe. See that file
-- for why both are kept. Its successful application on deploy is the evidence
-- that the Dockerfile CMD runs migrations at boot.
ALTER TABLE "User" DROP COLUMN IF EXISTS "zzMigrationProbe";
