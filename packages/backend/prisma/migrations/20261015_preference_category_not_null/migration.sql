-- Make PreferenceOption.category non-nullable.
--
-- Corrects a real hole in 20261014_discovery_preferences. That migration created a
-- plain unique index on (kind, category, value) and its comment claimed NULLs would
-- be handled. They were not: Postgres treats NULLs as *distinct* inside a unique
-- index, so two INTEREST rows with value "travel" and category NULL were both
-- accepted. The constraint silently did not constrain the two kinds that most need
-- it.
--
-- The same nullability is why the seeder failed on its first upsert: Prisma cannot
-- build a compound-unique selector that contains a nullable column, so
-- `kind_category_value: { kind, category: null, value }` is not expressible.
--
-- Empty string is the sentinel for the flat kinds. It is not a magic value so much
-- as the smallest non-null string: it sorts predictably, needs no coalesce at read
-- time beyond a truthiness check, and leaves the unique index doing real work.
--
-- No data is at risk. PreferenceOption was created empty and nothing has been
-- seeded yet, but the UPDATE is written to be safe if that ever stops being true.

UPDATE "PreferenceOption" SET "category" = '' WHERE "category" IS NULL;

ALTER TABLE "PreferenceOption"
    ALTER COLUMN "category" SET DEFAULT '',
    ALTER COLUMN "category" SET NOT NULL;

-- The index definition is unchanged and still correct; it was only inert while the
-- column was nullable. Dropping and recreating it would be a no-op that costs a
-- table rewrite, so it is deliberately left alone.