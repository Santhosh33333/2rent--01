/**
 * Seed real, upcoming events.
 *
 * Why a script and not the API: these are PUBLIC listings. A row created here
 * is indistinguishable on the marketing site from one a real organiser created,
 * so the content has to be real content that somebody actually decided on.
 * This script deliberately ships with an empty list — it will refuse to run
 * rather than invent placeholder events, because a fabricated "Sunrise Yoga
 * Session" on a public page is exactly the failure the landing hero's comments
 * warn about.
 *
 * Usage:
 *   1. Fill in prisma/seed-events.json   (see the shape below / the sibling file)
 *   2. npx tsx prisma/seed-events.ts --organizer <email>
 *
 * Safety: every row is validated before a single insert, and the whole thing
 * runs in one transaction, so a bad entry cannot leave half the list loaded.
 * Re-running is safe: rows are matched on (title, startTime) and updated rather
 * than duplicated.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type SeedEvent = {
  title: string;
  description?: string;
  category: string;
  subcategory?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  /** ISO 8601, must be in the future. */
  startTime: string;
  /** ISO 8601, must be after startTime. Drives how long the event stays listed. */
  endTime?: string;
  capacity?: number;
  /** Omit or 0 for a free event. */
  price?: number;
  currency?: string;
  coverImageUrl?: string;
  isVerified?: boolean;
};

const prisma = new PrismaClient();
const DATA_FILE = resolve(__dirname, "seed-events.json");

function organizerEmail(): string {
  const i = process.argv.indexOf("--organizer");
  if (i === -1 || !process.argv[i + 1]) {
    console.error("Missing --organizer <email>. These events are attributed to a real account.");
    process.exit(1);
  }
  return process.argv[i + 1];
}

async function main() {
  let raw: SeedEvent[];
  let text: string;
  try {
    text = readFileSync(DATA_FILE, "utf8");
  } catch {
    console.error(`Could not find ${DATA_FILE}. Create it with an array of events (see the script header).`);
    process.exit(1);
  }
  // Windows editors (and PowerShell's `Set-Content -Encoding UTF8`) prepend a
  // BOM, which JSON.parse rejects outright. Left unhandled that surfaces as a
  // bogus "could not read the file" message for a file sitting right there.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  try {
    raw = JSON.parse(text);
  } catch (e) {
    console.error(`${DATA_FILE} is not valid JSON: ${(e as Error).message}`);
    process.exit(1);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    console.error(
      `${DATA_FILE} is empty.\n` +
        `Refusing to seed: an empty list would be a no-op, and inventing placeholder\n` +
        `events here would put fake listings on the public site. Add the real ones first.`,
    );
    process.exit(1);
  }

  const organizer = await prisma.user.findUnique({ where: { email: organizerEmail() }, select: { id: true } });
  if (!organizer) {
    console.error(`No user with that email. Check --organizer.`);
    process.exit(1);
  }

  // ---- validate everything before writing anything -------------------------
  const now = new Date();
  const errors: string[] = [];
  const seen = new Set<string>();

  raw.forEach((e, i) => {
    const at = `events[${i}]${e.title ? ` "${e.title}"` : ""}`;
    if (!e.title?.trim()) errors.push(`${at}: title is required`);
    if (!e.category?.trim()) errors.push(`${at}: category is required`);
    if (!e.startTime) {
      errors.push(`${at}: startTime is required`);
    } else {
      const start = new Date(e.startTime);
      if (isNaN(start.getTime())) errors.push(`${at}: startTime is not a valid date`);
      else if (start <= now) errors.push(`${at}: startTime ${start.toISOString()} is in the past — the public feed hides finished events, so it would never appear`);
      if (e.endTime) {
        const end = new Date(e.endTime);
        if (isNaN(end.getTime())) errors.push(`${at}: endTime is not a valid date`);
        else if (end <= start) errors.push(`${at}: endTime must be after startTime`);
      }
    }
    if (e.price !== undefined && e.price < 0) errors.push(`${at}: price cannot be negative`);
    if (e.capacity !== undefined && e.capacity < 0) errors.push(`${at}: capacity cannot be negative`);
    const key = `${e.title}|${e.startTime}`;
    if (seen.has(key)) errors.push(`${at}: duplicate of an earlier entry (same title + startTime)`);
    seen.add(key);
  });

  if (errors.length) {
    console.error("Refusing to seed. Fix these first:");
    errors.forEach((e) => console.error("  - " + e));
    process.exit(1);
  }

  // ---- write --------------------------------------------------------------
  let created = 0;
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    for (const e of raw) {
      const start = new Date(e.startTime);
      const data = {
        description: e.description ?? null,
        category: e.category,
        subcategory: e.subcategory ?? null,
        location: e.location ?? null,
        latitude: e.latitude ?? null,
        longitude: e.longitude ?? null,
        startTime: start,
        endTime: e.endTime ? new Date(e.endTime) : null,
        capacity: e.capacity ?? null,
        price: e.price ?? 0,
        currency: e.currency ?? "INR",
        coverImageUrl: e.coverImageUrl ?? null,
        isVerified: e.isVerified ?? false,
        status: "PUBLISHED",
        privacy: "PUBLIC",
      };

      // Re-runnable: match on the natural key instead of inserting duplicates.
      const existing = await tx.event.findFirst({
        where: { title: e.title, startTime: start },
        select: { id: true },
      });

      if (existing) {
        await tx.event.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await tx.event.create({ data: { ...data, organizerId: organizer.id } });
        created++;
      }
    }
  });

  console.log(`Seeded ${created} new event(s), updated ${updated}.`);
  console.log("They appear on / once the earliest startTime is in the future.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());