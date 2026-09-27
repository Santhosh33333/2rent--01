-- TEMPORARY probe rollback: removes the probe column added in the previous
-- migration, proving the deploy-time migrate step works end to end.
ALTER TABLE "User" DROP COLUMN IF EXISTS "zzMigrationProbe";
