-- Event discovery rebuild: DB-driven categories + real filtering columns.

-- ---------------------------------------------------------------------------
-- EventCategory: replaces the hardcoded const list so admins can reorder,
-- rename, hide, restyle and add categories without a code change.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EventCategory" (
    "id"             TEXT NOT NULL,
    "key"            TEXT NOT NULL,
    "label"          TEXT NOT NULL,
    "description"    TEXT,
    "icon"           TEXT,
    "coverImageUrl"  TEXT,
    "sortOrder"      INTEGER NOT NULL DEFAULT 0,
    "enabled"        BOOLEAN NOT NULL DEFAULT true,
    "isVerifiedOnly" BOOLEAN NOT NULL DEFAULT false,
    "subcategories"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventCategory_key_key" ON "EventCategory"("key");
CREATE INDEX IF NOT EXISTS "EventCategory_enabled_sortOrder_idx" ON "EventCategory"("enabled", "sortOrder");

-- ---------------------------------------------------------------------------
-- Event: columns the filter panel needs. All nullable/defaulted so existing
-- rows stay valid and no backfill is required.
-- ---------------------------------------------------------------------------
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "organizerType"  TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "latitude"       DOUBLE PRECISION;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "longitude"      DOUBLE PRECISION;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "isOnline"       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "onlineUrl"      TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "currency"       TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "timezone"       TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "isVerified"     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "womenOnly"      BOOLEAN NOT NULL DEFAULT false;

-- Indexes backing the real query paths.
CREATE INDEX IF NOT EXISTS "Event_status_endTime_idx"        ON "Event"("status", "endTime");
CREATE INDEX IF NOT EXISTS "Event_privacy_startTime_idx"     ON "Event"("privacy", "startTime");
CREATE INDEX IF NOT EXISTS "Event_createdAt_idx"             ON "Event"("createdAt");
CREATE INDEX IF NOT EXISTS "Event_price_idx"                 ON "Event"("price");
CREATE INDEX IF NOT EXISTS "Event_organizerType_idx"         ON "Event"("organizerType");
CREATE INDEX IF NOT EXISTS "Event_latitude_longitude_idx"    ON "Event"("latitude", "longitude");

-- ---------------------------------------------------------------------------
-- Seed the category list in the requested order. Idempotent so re-running is
-- safe. "All Events" is intentionally absent: it is a pseudo-category served
-- by the API, not a row.
-- ---------------------------------------------------------------------------
INSERT INTO "EventCategory" ("id", "key", "label", "icon", "sortOrder", "enabled", "subcategories") VALUES
  (gen_random_uuid()::text, 'walking',      'Walking',          '🚶',  10, true, ARRAY['Morning Walk','Group Walk','Trail Walk']),
  (gen_random_uuid()::text, 'running',      'Running',          '🏃',  20, true, ARRAY['5K Run','Marathon','Jogging']),
  (gen_random_uuid()::text, 'cycling',      'Cycling',          '🚴',  30, true, ARRAY['Road Ride','Cycling Tour','MTB']),
  (gen_random_uuid()::text, 'football',     'Football',         '⚽',  40, true, ARRAY['5-a-side','Futsal','Tournament']),
  (gen_random_uuid()::text, 'cricket',      'Cricket',          '🏏',  50, true, ARRAY['Gully Cricket','Box Cricket','League']),
  (gen_random_uuid()::text, 'badminton',    'Badminton',        '🏸',  60, true, ARRAY['Singles','Doubles','Casual']),
  (gen_random_uuid()::text, 'tennis',       'Tennis',           '🎾',  70, true, ARRAY['Singles','Doubles','Court Booking']),
  (gen_random_uuid()::text, 'basketball',   'Basketball',       '🏀',  80, true, ARRAY['Street','Pickup Game','3v3']),
  (gen_random_uuid()::text, 'volleyball',   'Volleyball',       '🏐',  90, true, ARRAY['Indoor','Beach','Casual']),
  (gen_random_uuid()::text, 'gym-fitness',  'Gym & Fitness',   '🏋️', 100, true, ARRAY['Gym Session','CrossFit','Zumba']),
  (gen_random_uuid()::text, 'yoga',         'Yoga',             '🧘', 110, true, ARRAY['Vinyasa','Hatha','Meditation']),
  (gen_random_uuid()::text, 'travel',       'Travel',           '✈️', 120, true, ARRAY['Weekend Trip','Backpacking','City Tour']),
  (gen_random_uuid()::text, 'movies',       'Movies',           '🎬', 130, true, ARRAY['Screening','Film Discussion','Outdoor Screening']),
  (gen_random_uuid()::text, 'music',        'Music',            '🎵', 140, true, ARRAY['Jam Session','Live Band','Open Mic']),
  (gen_random_uuid()::text, 'concerts',     'Concerts',         '🎤', 150, true, ARRAY['Live Concert','Festival','Gig']),
  (gen_random_uuid()::text, 'photography',  'Photography',      '📷', 160, true, ARRAY['Photo Walk','Workshop','Shoot']),
  (gen_random_uuid()::text, 'gaming',       'Gaming',           '🎮', 170, true, ARRAY['LAN','Board Game','Casual Gaming']),
  (gen_random_uuid()::text, 'esports',      'Esports',          '🕹️', 180, true, ARRAY['Tournament','LAN Final','Open Qualifier']),
  (gen_random_uuid()::text, 'chess',        'Chess',            '♟️', 190, true, ARRAY['Casual','Tournament','Simultaneous']),
  (gen_random_uuid()::text, 'food',         'Food',             '🍽️', 200, true, ARRAY['Food Walk','Potluck','Restaurant Meet']),
  (gen_random_uuid()::text, 'coffee',       'Coffee',           '☕', 210, true, ARRAY['Coffee Meetup','Cupping','Study Cafe']),
  (gen_random_uuid()::text, 'cooking',      'Cooking',          '👨‍🍳', 220, true, ARRAY['Cook Along','Recipe Swap','Street Food Tour']),
  (gen_random_uuid()::text, 'shopping',     'Shopping',         '🛍️', 230, true, ARRAY['Market Walk','Flea Market','Mall Meet']),
  (gen_random_uuid()::text, 'technology',   'Technology',       '💻', 240, true, ARRAY['Meetup','Demo Day','Tech Talk']),
  (gen_random_uuid()::text, 'coding',       'Coding',           '👨‍💻', 250, true, ARRAY['Hack Night','Pair Programming','Code Review']),
  (gen_random_uuid()::text, 'business',     'Business',         '📈', 260, true, ARRAY['Networking','Masterclass','Pitch Night']),
  (gen_random_uuid()::text, 'startups',     'Startups',         '🚀', 270, true, ARRAY['Founder Meetup','Demo Day','Pitch Clinic']),
  (gen_random_uuid()::text, 'study',        'Study',            '📚', 280, true, ARRAY['Study Group','Revision','Library']),
  (gen_random_uuid()::text, 'books',        'Books',            '📖', 290, true, ARRAY['Book Club','Author Talk','Reading Circle']),
  (gen_random_uuid()::text, 'education',    'Education',        '🎓', 300, true, ARRAY['Workshop','Seminar','Coaching']),
  (gen_random_uuid()::text, 'art',          'Art',              '🎨', 310, true, ARRAY['Art Walk','Workshop','Exhibition']),
  (gen_random_uuid()::text, 'dance',        'Dance',            '💃', 320, true, ARRAY['Ballet','Hip Hop','Flashmob']),
  (gen_random_uuid()::text, 'nature',       'Nature',           '🌿', 330, true, ARRAY['Nature Walk','Bird Watching','Cleanup']),
  (gen_random_uuid()::text, 'beach',        'Beach',            '🏖️', 340, true, ARRAY['Beach Volleyball','Sunset Meet','Beach Cleanup']),
  (gen_random_uuid()::text, 'hiking',       'Hiking',           '🥾', 350, true, ARRAY['Day Hike','Trek','Trail Walk']),
  (gen_random_uuid()::text, 'volunteering', 'Volunteering',     '🤝', 360, true, ARRAY['Clean-up','Teaching','NGO Work']),
  (gen_random_uuid()::text, 'pets',         'Pets',             '🐾', 370, true, ARRAY['Pet Meetup','Adoption Drive','Training']),
  (gen_random_uuid()::text, 'cars',         'Cars',             '🚗', 380, true, ARRAY['Car Meet','Track Day','Road Trip']),
  (gen_random_uuid()::text, 'bikes',        'Bikes',            '🏍️', 390, true, ARRAY['Bike Meet','Long Ride','Track Day']),
  (gen_random_uuid()::text, 'fashion',      'Fashion',          '👗', 400, true, ARRAY['Style Swap','Runway','Thrift Meet']),
  (gen_random_uuid()::text, 'networking',   'Networking',       '🤝', 410, true, ARRAY['Meetup','Coworking','Speed Networking']),
  (gen_random_uuid()::text, 'local-events', 'Local Events',     '📍', 420, true, ARRAY['Flea Market','Festival','Community']),
  (gen_random_uuid()::text, 'community',    'Community',        '🏘️', 430, true, ARRAY['Meetup','Volunteering','Social']),
  (gen_random_uuid()::text, 'workshops',    'Workshops',        '🛠️', 440, true, ARRAY['Hands-on','Skill Building','Bootcamp']),
  (gen_random_uuid()::text, 'astrology',    'Astrology',        '🔮', 450, true, ARRAY['Astrology Meetups','Horoscope Discussions','Birth Chart Workshops','Vedic Astrology','Numerology','Spiritual Discussions','Astrology Learning Sessions','Astrology Community Meetups']),
  (gen_random_uuid()::text, 'other',        'Other',            '📦', 999, true, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;
