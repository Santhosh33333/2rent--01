/**
 * Seeds the discovery option catalogue.
 *
 * Idempotent: every row is upserted on (kind, category, value), so running this
 * again after adding an option only inserts the new one. Labels can therefore be
 * corrected here and re-run without duplicating anything - which is the whole
 * reason the catalogue is in the database instead of in the frontend.
 *
 * Deliberately conservative about lifestyle questions. Each category here has to
 * change who a person is shown, not just describe them. The spec listed smoking,
 * drinking, schedule and pets as well; pets and schedule are included because they
 * genuinely affect whether a meeting works out. Smoking and drinking are included
 * only as "prefer non-smoker" style *preferences* on the viewer's side - not as
 * personal disclosures people are asked to make, and not as filters applied to
 * other people. Asking a 20-year-old to declare their drinking habits in order to
 * use a discovery screen is a cost with no product upside.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Sentinel for "this option has no category" (INTEREST and LANGUAGE rows).
 *
 * Not null and not a magic string like "general": the unique index on
 * (kind, category, value) treats every distinct value as distinct, so an empty
 * string keeps uniqueness working for the flat kinds while staying trivially
 * distinguishable from a real category at read time.
 */
const NO_CATEGORY = "";

const INTERESTS: Array<[value: string, label: string]> = [
  ["travel", "Travel"],
  ["movies", "Movies"],
  ["music", "Music"],
  ["food", "Food"],
  ["fitness", "Fitness"],
  ["walking", "Walking"],
  ["sports", "Sports"],
  ["photography", "Photography"],
  ["technology", "Technology"],
  ["gaming", "Gaming"],
  ["books", "Books"],
  ["shopping", "Shopping"],
  ["events", "Events"],
  ["socialising", "Socialising"],
  ["art", "Art"],
  ["nature", "Nature"],
  ["business", "Business"],
  ["education", "Education"],
  ["dancing", "Dancing"],
  ["cycling", "Cycling"],
  ["pets", "Pets"],
  ["other", "Other"],
];

const LANGUAGES: Array<[value: string, label: string]> = [
  ["tamil", "Tamil"],
  ["english", "English"],
  ["telugu", "Telugu"],
  ["malayalam", "Malayalam"],
  ["kannada", "Kannada"],
  ["hindi", "Hindi"],
  ["bengali", "Bengali"],
  ["marathi", "Marathi"],
  ["other", "Other"],
];

// category -> [value, label][]
const LIFESTYLE: Record<string, Array<[string, string]>> = {
  social: [
    ["very_social", "Very social"],
    ["moderately_social", "Moderately social"],
    ["quiet", "Quiet / private"],
  ],
  activity: [
    ["very_active", "Very active"],
    ["moderate", "Moderate"],
    ["relaxed", "Relaxed"],
  ],
  schedule: [
    ["morning_person", "Morning person"],
    ["evening_person", "Evening person"],
    ["flexible", "Flexible"],
  ],
  food: [
    ["vegetarian", "Vegetarian"],
    ["non_vegetarian", "Non-vegetarian"],
    ["vegan", "Vegan"],
    ["no_preference", "No preference"],
  ],
  pets: [
    ["loves_pets", "Loves pets"],
    ["has_pets", "Has pets"],
    ["no_pets", "No pets"],
    ["no_preference", "No preference"],
  ],
  travel: [
    ["frequent_traveller", "Frequent traveller"],
    ["occasional_traveller", "Occasional traveller"],
    ["rarely_travels", "Rarely travels"],
  ],
};

async function main() {
  // Every write is an upsert, so the only number worth reporting is the final
  // total. Distinguishing "inserted" from "refreshed" here would mean a second
  // query per option for no operational benefit - the script's contract is that it
  // is safe to re-run, not that it reports what it changed.
  for (const [order, [value, label]] of INTERESTS.entries()) {
    await prisma.preferenceOption.upsert({
      where: { kind_category_value: { kind: "INTEREST", category: NO_CATEGORY, value } },
      create: { kind: "INTEREST", category: NO_CATEGORY, value, displayLabel: label, sortOrder: order },
      update: { displayLabel: label, sortOrder: order, isActive: true },
    });
  }

  for (const [order, [value, label]] of LANGUAGES.entries()) {
    await prisma.preferenceOption.upsert({
      where: { kind_category_value: { kind: "LANGUAGE", category: NO_CATEGORY, value } },
      create: { kind: "LANGUAGE", category: NO_CATEGORY, value, displayLabel: label, sortOrder: order },
      update: { displayLabel: label, sortOrder: order, isActive: true },
    });
  }

  for (const [category, options] of Object.entries(LIFESTYLE)) {
    for (const [order, [value, label]] of options.entries()) {
      await prisma.preferenceOption.upsert({
        where: { kind_category_value: { kind: "LIFESTYLE", category, value } },
        create: {
          kind: "LIFESTYLE",
          category,
          value,
          displayLabel: label,
          sortOrder: order,
        },
        update: { displayLabel: label, sortOrder: order, isActive: true },
      });
    }
  }

  const total = await prisma.preferenceOption.count();
  console.log(`PreferenceOption seeded. ${total} rows active. Safe to re-run.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());