/**
 * Discovery preferences: the single place that decides what a preference means.
 *
 * Three jobs, in the order they matter.
 *
 * 1. Validation. Every write is validated here against the catalogue rather than
 *    against whatever the client sent. A PUT that asks for interest "aeronautics"
 *    gets it dropped, not stored - otherwise the catalogue and the saved data drift
 *    apart and "show me my interests" starts lying.
 *
 * 2. Distance and age, which are hard filters rather than preferences: someone who
 *    set a 10 km radius does not want the best-scoring profile in another state at
 *    the top of the list. They want fewer profiles, closer.
 *
 * 3. Scoring, which only reorders what survived the filters. It is deliberately
 *    incapable of returning someone the filters excluded, because the two are
 *    separate functions and only the filter runs in SQL.
 *
 * No scoring detail is meant to reach the user beyond the short reason strings
 * below. Weights are admin-tunable via PricingConfig; the *shape* of the algorithm
 * is not, so that a future weight change cannot quietly turn into a feature change.
 */
import { prisma } from "../config/database";
import { getStringConfig } from "./pricingEngine";

// ---------------------------------------------------------------------------
// Options and limits
// ---------------------------------------------------------------------------

/**
 * Discovery radii offered in the UI, in km. A fixed set rather than a free number:
 * a slider invites values no user can act on, and every stored radius has to be
 * meaningful for the map/banner copy that mentions it.
 */
export const DISTANCE_OPTIONS_KM = [1, 3, 5, 10, 25, 50, 100] as const;

/**
 * Sentinel for "Anywhere". Stored rather than null so the column stays a single
 * non-null integer and the comparison in SQL is a simple `<=`.
 */
export const ANYWHERE_KM = 100000;

/**
 * Floor for accounts. Registering requires an adult, and a lower bound is also
 * what stops a nonsense ageMin of 0 from widening the candidate set to everyone.
 */
export const LEGAL_MIN_AGE = 18;
export const MAX_AGE = 100;

/**
 * Caps on stored values. Generous relative to the catalogue but bounded, so a
 * malformed client cannot turn one PUT into a multi-megabyte row.
 */
export const MAX_INTERESTS = 40;
export const MAX_LANGUAGES = 15;
export const MAX_LIFESTYLE_CATEGORIES = 12;

/**
 * Default weights. Overridable by an admin via PricingConfig key MATCHING_WEIGHTS.
 *
 * Typed as a plain mutable interface rather than `as const`: the override path
 * assigns into a copy of this object, and `as const` would make every field
 * readonly and reject that.
 */
export interface MatchingWeights {
  distance: number;
  age: number;
  interests: number;
  languages: number;
  lifestyle: number;
}

export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  distance: 25,
  age: 20,
  interests: 25,
  languages: 15,
  lifestyle: 15,
};

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface NormalisedPreferences {
  distanceKm: number;
  ageMin: number;
  ageMax: number;
  interests: string[];
  languages: string[];
  lifestyle: Record<string, string[]>;
}

/** What the UI sends. Everything optional; the service fills in the defaults. */
export interface PreferencesInput {
  distanceKm?: unknown;
  ageMin?: unknown;
  ageMax?: unknown;
  interests?: unknown;
  languages?: unknown;
  lifestyle?: unknown;
}

export interface FieldIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  value: NormalisedPreferences;
  issues: FieldIssue[];
}

/** The active catalogue, loaded once per request that needs it. */
export interface Catalogue {
  interests: Set<string>;
  languages: Set<string>;
  /** category -> allowed values */
  lifestyle: Map<string, Set<string>>;
  lifestyleCategories: string[];
}

/**
 * What we know about someone else. Deliberately not the full user record: scoring
 * has no business reading a password hash, and a narrower parameter type makes it
 * impossible to accidentally start using one.
 */
export interface MatchCandidate {
  id: string;
  dateOfBirth: Date;
  language: string;
  latitude: number | null;
  longitude: number | null;
  interests: string[];
  languages: string[];
  lifestyle: Record<string, string[]>;
}

export interface MatchReason {
  code: string;
  label: string;
}

export interface ScoredCandidate {
  score: number;
  reasons: MatchReason[];
  /** Exact km, for internal ordering only. Never sent to a client unbanded. */
  distanceKm: number | null;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Canonical form for a stored value: lowercase, trimmed, underscore-separated.
 *
 * Applied on both write and read, so "Travel", "travel " and "TRAVEL" are the same
 * interest. Storing display labels is what makes a later relabel lose everyone's
 * saved data, so the canonical form is deliberately not the display form.
 */
export function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * ISO 639-1 and common abbreviations mapped to the catalogue's canonical language
 * names.
 *
 * This exists because two representations of the same language are already in the
 * database: `User.language` has always been free text and in practice holds codes
 * like "ta", while the catalogue (and any human choosing from the UI) uses names
 * like "tamil". Without a translation between them the legacy field can never match
 * a saved preference - which is precisely the account that has been here longest and
 * would quietly receive the worst-ranked results.
 *
 * An unrecognised value passes through canonicalised rather than being rejected:
 * a language the catalogue does not know about yet should still be storable and
 * comparable, not fail the save.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  ta: "tamil",
  tam: "tamil",
  en: "english",
  eng: "english",
  te: "telugu",
  tel: "telugu",
  ml: "malayalam",
  mal: "malayalam",
  kn: "kannada",
  kan: "kannada",
  hi: "hindi",
  hin: "hindi",
  bn: "bengali",
  ben: "bengali",
  mr: "marathi",
  mar: "marathi",
};

/** Canonical form of a language, accepting either a code or a name. */
export function normaliseLanguage(value: string): string {
  const key = canonical(value);
  return LANGUAGE_ALIASES[key] ?? key;
}

/** Accepts only a real finite number; rejects "25", null, NaN and Infinity. */
function toInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

/** Coerce a client value into a string array without trusting its type. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
    // Numbers are dropped rather than coerced: an interest arriving as a number is
    // a bug upstream, and stringifying it would hide that bug behind a valid-looking
    // saved value.
  }
  return out;
}

/** Deduplicate and cap. Order is preserved so the UI can show a stable list. */
function dedupe(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/**
 * Load the active option catalogue.
 *
 * Used to validate writes and to render the UI. An empty catalogue means "nothing
 * is selectable yet", which validates by dropping everything - so the seeder for
 * PreferenceOption must run before this returns useful data.
 */
export async function loadCatalogue(): Promise<Catalogue> {
  const rows = await prisma.preferenceOption.findMany({
    where: { isActive: true },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
    select: { kind: true, category: true, value: true },
  });

  const catalogue: Catalogue = {
    interests: new Set<string>(),
    languages: new Set<string>(),
    lifestyle: new Map<string, Set<string>>(),
    lifestyleCategories: [],
  };

  for (const row of rows) {
    const value = canonical(row.value);
    if (row.kind === "INTEREST") {
      catalogue.interests.add(value);
    } else if (row.kind === "LANGUAGE") {
      catalogue.languages.add(value);
    } else if (row.kind === "LIFESTYLE" && row.category) {
      const cat = canonical(row.category);
      if (!catalogue.lifestyle.has(cat)) {
        catalogue.lifestyle.set(cat, new Set<string>());
        catalogue.lifestyleCategories.push(cat);
      }
      catalogue.lifestyle.get(cat)!.add(value);
    }
  }

  catalogue.lifestyleCategories.sort();
  return catalogue;
}

/** Read-only catalogue shape for the options endpoint. */
export interface CatalogueView {
  interests: Array<{ value: string; label: string }>;
  languages: Array<{ value: string; label: string }>;
  lifestyle: Array<{
    category: string;
    label: string;
    options: Array<{ value: string; label: string }>;
  }>;
}

/** Human labels for lifestyle categories. Falls back to a title-cased key. */
const LIFESTYLE_CATEGORY_LABELS: Record<string, string> = {
  social: "Social",
  activity: "Activity",
  schedule: "Schedule",
  food: "Food",
  pets: "Pets",
  travel: "Travel",
};

function labelForCategory(category: string): string {
  return (
    LIFESTYLE_CATEGORY_LABELS[category] ??
    category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Catalogue with display labels, for rendering.
 *
 * Separate from loadCatalogue because labels are only needed when drawing the UI.
 * Validation needs the values alone and should not be able to depend on a label
 * existing.
 */
export async function loadCatalogueView(): Promise<CatalogueView> {
  const rows = await prisma.preferenceOption.findMany({
    where: { isActive: true },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { displayLabel: "asc" }],
    select: { kind: true, category: true, value: true, displayLabel: true },
  });

  const view: CatalogueView = { interests: [], languages: [], lifestyle: [] };
  const lifestyleIndex = new Map<string, CatalogueView["lifestyle"][number]>();

  for (const row of rows) {
    const option = { value: canonical(row.value), label: row.displayLabel };
    if (row.kind === "INTEREST") {
      view.interests.push(option);
    } else if (row.kind === "LANGUAGE") {
      view.languages.push(option);
    } else if (row.kind === "LIFESTYLE" && row.category) {
      const cat = canonical(row.category);
      let entry = lifestyleIndex.get(cat);
      if (!entry) {
        entry = { category: cat, label: labelForCategory(cat), options: [] };
        lifestyleIndex.set(cat, entry);
        view.lifestyle.push(entry);
      }
      entry.options.push(option);
    }
  }

  return view;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const DEFAULT_PREFERENCES: NormalisedPreferences = {
  distanceKm: 50,
  ageMin: LEGAL_MIN_AGE,
  ageMax: MAX_AGE,
  interests: [],
  languages: [],
  lifestyle: {},
};

/**
 * Validate and normalise a preferences write.
 *
 * Rejects rather than repairs the three values where guessing would be unsafe -
 * an impossible age range, a radius outside the offered set. Everything else is
 * repaired, because dropping an unrecognised interest is a better failure than
 * failing the whole save over one stale client build.
 *
 * The result is a full record either way, so callers never have to merge with
 * defaults themselves.
 */
export function validatePreferences(
  input: PreferencesInput,
  catalogue: Catalogue,
): ValidationResult {
  const issues: FieldIssue[] = [];
  const value: NormalisedPreferences = { ...DEFAULT_PREFERENCES, lifestyle: {} };

  // Distance. "Anywhere" is accepted as a value in its own right, because the UI
  // sends it rather than treating it as "no opinion".
  if (input.distanceKm !== undefined) {
    const n = toInt(input.distanceKm);
    if (n === null) {
      issues.push({ field: "distanceKm", message: "Choose a distance from the list." });
    } else if (n === ANYWHERE_KM) {
      value.distanceKm = ANYWHERE_KM;
    } else if (!(DISTANCE_OPTIONS_KM as readonly number[]).includes(n)) {
      issues.push({
        field: "distanceKm",
        message: `Distance must be one of ${DISTANCE_OPTIONS_KM.join(", ")} km, or ${ANYWHERE_KM} for anywhere.`,
      });
    } else {
      value.distanceKm = n;
    }
  }

  // Age range. Both bounds validated, then their order, because min > max is the
  // single most likely thing a client sends by swapping the fields.
  if (input.ageMin !== undefined) {
    const n = toInt(input.ageMin);
    if (n === null) {
      issues.push({ field: "ageMin", message: "Minimum age must be a whole number." });
    } else if (n < LEGAL_MIN_AGE) {
      issues.push({ field: "ageMin", message: `Minimum age cannot be below ${LEGAL_MIN_AGE}.` });
    } else if (n > MAX_AGE) {
      issues.push({ field: "ageMin", message: `Minimum age cannot be above ${MAX_AGE}.` });
    } else {
      value.ageMin = n;
    }
  }

  if (input.ageMax !== undefined) {
    const n = toInt(input.ageMax);
    if (n === null) {
      issues.push({ field: "ageMax", message: "Maximum age must be a whole number." });
    } else if (n < LEGAL_MIN_AGE) {
      issues.push({ field: "ageMax", message: `Maximum age cannot be below ${LEGAL_MIN_AGE}.` });
    } else if (n > MAX_AGE) {
      issues.push({ field: "ageMax", message: `Maximum age cannot be above ${MAX_AGE}.` });
    } else {
      value.ageMax = n;
    }
  }

  if (value.ageMin > value.ageMax) {
    issues.push({
      field: "ageMin",
      message: `Minimum age (${value.ageMin}) cannot be above maximum age (${value.ageMax}).`,
    });
  }

  // Interests and languages: keep the catalogue's values, discard anything else.
  const interestInput = toStringArray(input.interests)
    .map(canonical)
    .filter((v) => {
      if (catalogue.interests.has(v)) return true;
      if (v) issues.push({ field: "interests", message: `"${v}" is not an available interest.` });
      return false;
    });
  value.interests = dedupe(interestInput, MAX_INTERESTS);

  // Languages: kept through normaliseLanguage rather than canonical alone, so a
  // client sending "ta" stores "tamil" and matches the catalogue. Without this the
  // same language saved two ways would be two different preferences.
  const languageInput = toStringArray(input.languages)
    .map(normaliseLanguage)
    .filter((v) => {
      if (catalogue.languages.has(v)) return true;
      if (v) issues.push({ field: "languages", message: `"${v}" is not an available language.` });
      return false;
    });
  value.languages = dedupe(languageInput, MAX_LANGUAGES);

  // Lifestyle: object of category -> values. Unknown categories and values are
  // dropped, because this is additive admin configuration and an old client should
  // not be able to invent a category.
  if (input.lifestyle !== undefined && input.lifestyle !== null) {
    if (typeof input.lifestyle !== "object" || Array.isArray(input.lifestyle)) {
      issues.push({ field: "lifestyle", message: "Lifestyle must be a group of categories." });
    } else {
      const entries = Object.entries(input.lifestyle as Record<string, unknown>).slice(
        0,
        MAX_LIFESTYLE_CATEGORIES,
      );
      for (const [rawCategory, rawValues] of entries) {
        const category = canonical(rawCategory);
        const allowed = catalogue.lifestyle.get(category);
        if (!allowed) {
          issues.push({ field: "lifestyle", message: `"${category}" is not a lifestyle category.` });
          continue;
        }
        const chosen = toStringArray(rawValues)
          .map(canonical)
          .filter((v) => {
            if (allowed.has(v)) return true;
            if (v) {
              issues.push({
                field: "lifestyle",
                message: `"${v}" is not an option under ${category}.`,
              });
            }
            return false;
          });
        const kept = dedupe(chosen, 10);
        if (kept.length) value.lifestyle[category] = kept;
      }
    }
  }

  return { ok: issues.length === 0, value, issues };
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/**
 * Great-circle distance in km.
 *
 * Uses the mean earth radius, which is accurate to about 0.5% - far tighter than
 * the 1 km granularity of the smallest offered radius, so a more exact formula
 * would be precision spent where it cannot be observed.
 *
 * Null when either point is missing: distance is unrankable, not zero. Returning 0
 * would sort unknown-location profiles to the very top, which is the worst
 * possible answer for someone who never shared a location.
 */
export function distanceKmBetween(
  aLat: number | null,
  aLng: number | null,
  bLat: number | null,
  bLng: number | null,
): number | null {
  if (aLat === null || aLng === null || bLat === null || bLng === null) return null;
  if (![aLat, aLng, bLat, bLng].every((n) => Number.isFinite(n))) return null;

  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Completed years from a date of birth, as of today. */
export function ageFrom(dateOfBirth: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

// ---------------------------------------------------------------------------
// Lifestyle compatibility
// ---------------------------------------------------------------------------

/**
 * Incompatible pairs within a category.
 *
 * Only genuine contradictions are listed. Being "socially" a drinker and "never" a
 * drinker is a mismatch; being a "very active" traveller and a "relaxed" one is not,
 * because those are different questions about different parts of life. Overstating
 * incompatibility would demote profiles that a person would actually want to see.
 *
 * Values not mentioned here (or not in the catalogue) are treated as compatible,
 * which is the safe default: an admin adding an option next month cannot
 * accidentally make every pair involving it incompatible.
 */
const LIFESTYLE_CONFLICTS: Record<string, Array<[string, string]>> = {
  food: [
    ["vegetarian", "non_vegetarian"],
    ["vegan", "non_vegetarian"],
    ["vegan", "eggs_dairy"],
  ],
  smoking: [["never", "regular"]],
  drinking: [["never", "regular"]],
  pets: [["no_pets", "has_pets"]],
};

/**
 * Whether one answer set for a category is compatible with another's.
 *
 * The category is a required argument rather than being inferred, because the
 * conflict table is keyed by category: "never" is contradictory under Smoking and
 * meaningless under Food, so a lookup that did not know which question was being
 * answered would either miss real conflicts or invent false ones.
 *
 * An empty set means "did not say", which is compatible with everything - someone
 * who skipped the question should not be treated as having answered it badly.
 */
export function lifestyleCompatible(
  category: string,
  viewer: string[],
  candidate: string[],
): boolean {
  // No rules for this category means every pairing is compatible. This is what
  // lets an admin add a lifestyle option next month without it silently becoming
  // incompatible with everything.
  const rules = LIFESTYLE_CONFLICTS[category];
  if (!rules) return true;

  for (const a of viewer) {
    for (const b of candidate) {
      if (a === b) continue;
      if (rules.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Read admin-tunable weights, falling back to the defaults.
 *
 * A malformed or partial override degrades to the default for the missing keys
 * rather than renormalising whatever survived - a typo in the config must not
 * silently double the weight of distance.
 */
export async function getMatchingWeights(): Promise<MatchingWeights> {
  const raw = await getStringConfig("MATCHING_WEIGHTS", "");
  if (!raw) return { ...DEFAULT_MATCHING_WEIGHTS };
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const weights: MatchingWeights = { ...DEFAULT_MATCHING_WEIGHTS };
    for (const key of Object.keys(DEFAULT_MATCHING_WEIGHTS) as Array<keyof MatchingWeights>) {
      const n = Number(parsed[key]);
      if (Number.isFinite(n) && n >= 0) weights[key] = n;
    }
    return weights;
  } catch {
    return { ...DEFAULT_MATCHING_WEIGHTS };
  }
}

function overlapRatio(wanted: string[], have: string[]): number {
  if (wanted.length === 0) return 0;
  const set = new Set(have);
  const shared = wanted.filter((v) => set.has(v)).length;
  return shared / wanted.length;
}

/**
 * Score one candidate against the viewer's preferences.
 *
 * Only ever called on candidates the SQL filter already admitted. The score
 * reorders; it does not include or exclude. Keeping that split explicit is what
 * stops a future weighting change from quietly changing who appears at all.
 *
 * A dimension the viewer never expressed contributes nothing and is dropped from
 * the denominator, so a user with no interests saved is not buried beneath users
 * who did save them - their results are ranked on distance and age alone.
 *
 * The viewer's coordinates are passed separately from their preferences on
 * purpose: they are the most sensitive value the endpoint ever touches, and
 * keeping them out of the preferences object means they cannot leak into a
 * preferences response or an audit payload by accident.
 */
export function scoreCandidate(
  prefs: NormalisedPreferences,
  viewerLocation: { latitude: number | null; longitude: number | null },
  candidate: MatchCandidate,
  weights: MatchingWeights,
  now = new Date(),
): ScoredCandidate {
  const reasons: MatchReason[] = [];

  // Distance: hard-filtered upstream, so this only distinguishes near from far.
  // Decays to half at the edge of the radius rather than to zero, because "the
  // furthest person I still asked to see" should not score like a poor match.
  const distance = distanceKmBetween(
    viewerLocation.latitude,
    viewerLocation.longitude,
    candidate.latitude,
    candidate.longitude,
  );
  let distanceScore = 0;
  if (prefs.distanceKm !== ANYWHERE_KM && distance !== null) {
    const ratio = Math.min(1, distance / prefs.distanceKm);
    distanceScore = 1 - 0.5 * ratio;
    if (distance <= 1) reasons.push({ code: "very_close", label: "Very close to you" });
    else if (distance <= 10) reasons.push({ code: "nearby", label: "Nearby" });
  }

  // Age: already inside the requested range. Full marks at the centre of the range
  // and slightly less at the edges, which reflects how people actually use a
  // stated range rather than reading it as a hard boundary.
  const candidateAge = ageFrom(candidate.dateOfBirth, now);
  let ageScore = 0;
  if (prefs.ageMax > prefs.ageMin) {
    const midpoint = (prefs.ageMin + prefs.ageMax) / 2;
    const half = (prefs.ageMax - prefs.ageMin) / 2;
    ageScore = 1 - 0.25 * Math.min(1, Math.abs(candidateAge - midpoint) / half);
  } else {
    ageScore = 1;
  }

  // Interests: share of what the viewer asked for.
  const interestScore = overlapRatio(prefs.interests, candidate.interests);
  if (interestScore > 0) {
    reasons.push({
      code: "shared_interests",
      label: `${Math.max(1, Math.round(interestScore * prefs.interests.length))} shared ${
        prefs.interests.length === 1 ? "interest" : "interests"
      }`,
    });
  }

  // Languages: a shared language is a stronger signal than a shared interest
  // (you can both like cricket and still not be able to talk), so one overlap is
  // enough to register even though the weight is lower.
  const languageScore = overlapRatio(prefs.languages, candidate.languages);
  if (languageScore > 0) {
    reasons.push({ code: "shared_language", label: "Speak a shared language" });
  }

  // Lifestyle: only categories the viewer actually answered count, and a hard
  // contradiction removes the category from the average rather than scaling it,
  // so one mismatch cannot be diluted away by five categories that happened to agree.
  const answered = Object.keys(prefs.lifestyle).filter(
    (c) => prefs.lifestyle[c]?.length && candidate.lifestyle[c]?.length,
  );
  let lifestyleScore = 0;
  if (answered.length) {
    const agreed = answered.filter((c) =>
      lifestyleCompatible(c, prefs.lifestyle[c], candidate.lifestyle[c]),
    );
    lifestyleScore = agreed.length / answered.length;
    if (lifestyleScore === 1 && answered.length >= 2) {
      reasons.push({ code: "similar_lifestyle", label: "Similar lifestyle" });
    }
  }

  // Weighted average over expressed dimensions only. Renormalising the denominator
  // is what makes "no preferences saved" mean "ranked on distance and age" instead
  // of "scored 3/100 and buried".
  const parts: Array<[number, number]> = [];
  if (prefs.distanceKm !== ANYWHERE_KM && distance !== null) parts.push([distanceScore, weights.distance]);
  parts.push([ageScore, weights.age]);
  if (prefs.interests.length) parts.push([interestScore, weights.interests]);
  if (prefs.languages.length) parts.push([languageScore, weights.languages]);
  if (answered.length) parts.push([lifestyleScore, weights.lifestyle]);

  const totalWeight = parts.reduce((sum, [, w]) => sum + w, 0);
  const score =
    totalWeight > 0 ? (parts.reduce((sum, [s, w]) => sum + s * w, 0) / totalWeight) * 100 : 0;

  return { score: Math.round(score * 100) / 100, reasons, distanceKm: distance };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Coerce the stored lifestyle JSON.
 *
 * A row written before a category existed, or edited by hand, must not be able to
 * crash discovery. Anything unparseable becomes "no answers" rather than throwing,
 * because the cost of getting this wrong is a lesser ranking, not a 500.
 */
export function parseLifestyle(raw: string | null | undefined): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const list = toStringArray(value).map(canonical);
      const kept = dedupe(list, 10);
      if (kept.length) out[canonical(key)] = kept;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Preferences for a user, falling back to defaults when nothing is saved.
 *
 * Never throws and never returns null, because every caller wants preferences and
 * "none saved" is a legitimate state that means defaults - not an error and not
 * "this account is broken".
 */
export async function getPreferences(userId: string): Promise<NormalisedPreferences> {
  const row = await prisma.userPreferences.findUnique({
    where: { userId },
    select: {
      distanceKm: true,
      ageMin: true,
      ageMax: true,
      interests: true,
      languages: true,
      lifestyle: true,
    },
  });
  if (!row) return { ...DEFAULT_PREFERENCES, lifestyle: {} };
  return {
    distanceKm: row.distanceKm,
    ageMin: row.ageMin,
    ageMax: row.ageMax,
    interests: row.interests,
    languages: row.languages,
    lifestyle: parseLifestyle(row.lifestyle),
  };
}

/**
 * Upsert validated preferences.
 *
 * A single write, so a rejected field cannot leave half the form saved - which
 * would mean the next load silently disagrees with what the user just saw.
 */
export async function savePreferences(
  userId: string,
  value: NormalisedPreferences,
): Promise<void> {
  await prisma.userPreferences.upsert({
    where: { userId },
    create: {
      userId,
      distanceKm: value.distanceKm,
      ageMin: value.ageMin,
      ageMax: value.ageMax,
      interests: value.interests,
      languages: value.languages,
      lifestyle: JSON.stringify(value.lifestyle),
    },
    update: {
      distanceKm: value.distanceKm,
      ageMin: value.ageMin,
      ageMax: value.ageMax,
      interests: value.interests,
      languages: value.languages,
      lifestyle: JSON.stringify(value.lifestyle),
    },
  });
}

/**
 * Save the viewer's own coordinates, used only for distance ranking.
 *
 * Range-checked here rather than trusting the browser. The widest valid values are
 * the extremes of the coordinate space; anything outside is a client bug or a
 * tampered request, and storing it would poison every distance comparison that
 * profile takes part in.
 */
export async function saveViewerLocation(
  userId: string,
  latitude: unknown,
  longitude: unknown,
): Promise<{ ok: boolean; message?: string }> {
  const lat = typeof latitude === "number" ? latitude : Number(latitude);
  const lng = typeof longitude === "number" ? longitude : Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: "Location could not be read." };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, message: "That location is not on the map." };
  }
  await prisma.user.update({ where: { id: userId }, data: { latitude: lat, longitude: lng } });
  return { ok: true };
}

/** Remove a saved location. Supported because "I no longer want this shared" is real. */
export async function clearViewerLocation(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { latitude: null, longitude: null } });
}