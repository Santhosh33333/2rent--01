-- One-time verification that the Docker CMD applies pending migrations at boot.
--
-- This migration and its "_revert" sibling shipped together in commit b7aed97
-- purely to prove the deploy-time "prisma migrate deploy" step runs, using
-- production as the test: this adds a probe column and the next one removes it.
-- Both are applied and recorded, so they are retained rather than deleted --
-- removing the files would leave _prisma_migrations holding rows that no longer
-- exist on disk, which is drift this project should not accumulate. They are
-- idempotent and no-ops on any future run.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "zzMigrationProbe" BOOLEAN NOT NULL DEFAULT false;
