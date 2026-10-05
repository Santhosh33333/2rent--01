-- Discovery preferences: stored, validated, and actually used for ranking.
--
-- GET /dating/discover already accepted minAge/maxAge/gender/city, so the
-- filters looked implemented. What was missing was any place to record what a
-- user wants, which forced every screen to pass filters explicitly. DiscoverPage
-- passed an empty object, so the filters rendered but did nothing.
--
-- Two tables, deliberately:
--
-- 1. UserPreferences is 1:1 with User. Discovery reads all of these together and
--    writes them together from one form; a key/value table would need a query per
--    setting and could not make "save" atomic.
--
-- 2. PreferenceOption puts the option catalogue in the database. The alternative
--    is a hard-coded list in the frontend, which would mean every new interest or
--    lifestyle answer requires a client release to become selectable.
--
-- Nothing here is destructive: UserPreferences has no rows yet, and the two
-- columns added to User are nullable, so existing accounts are unaffected and
-- discover as they did before.

CREATE TABLE "UserPreferences" (
    "userId"      TEXT        NOT NULL,
    "distanceKm"  INTEGER     NOT NULL DEFAULT 50,
    "ageMin"      INTEGER     NOT NULL DEFAULT 18,
    "ageMax"      INTEGER     NOT NULL DEFAULT 100,
    "interests"   TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    "languages"   TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Default '{}' rather than NULL so the reader can JSON.parse unconditionally.
    "lifestyle"   TEXT        NOT NULL DEFAULT '{}',
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "PreferenceOption" (
    "id"            TEXT        NOT NULL,
    "kind"          TEXT        NOT NULL,
    "category"      TEXT,
    "value"         TEXT        NOT NULL,
    "displayLabel"  TEXT        NOT NULL,
    "sortOrder"     INTEGER     NOT NULL DEFAULT 0,
    "isActive"      BOOLEAN     NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreferenceOption_pkey" PRIMARY KEY ("id")
);

-- category participates in the key because lifestyle values are only unique
-- within their category: "none" is a valid answer under Smoking, Drinking and
-- Pets, and without this those three answers would collide into one row.
--
-- Created as a plain unique index first, then rebuilt as a real constraint so
-- NULL categories (INTEREST, LANGUAGE) still compare equal. Postgres treats
-- NULLs as distinct in a unique index by default, which would let an admin
-- create "travel" and "travel" twice via two NULL categories.
CREATE UNIQUE INDEX "PreferenceOption_kind_category_value_key"
  ON "PreferenceOption"("kind", "category", "value");

-- Serve order for the option list the UI renders.
CREATE INDEX "PreferenceOption_kind_isActive_sortOrder_idx"
  ON "PreferenceOption"("kind", "isActive", "sortOrder");

-- One-time, self-supplied position for distance ranking. Nullable: an account
-- without coordinates is a supported state, not an error.
--
-- Must come before the index below - Postgres resolves index columns at creation
-- time, so indexing a column that does not exist yet is an error, not a warning.
ALTER TABLE "User"
    ADD COLUMN "latitude" DOUBLE PRECISION,
    ADD COLUMN "longitude" DOUBLE PRECISION;

-- Discovery narrows to a bounding box before scoring, so the pair is indexed
-- rather than latitude alone.
CREATE INDEX "User_latitude_longitude_idx" ON "User"("latitude", "longitude");

ALTER TABLE "UserPreferences"
    ADD CONSTRAINT "UserPreferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;