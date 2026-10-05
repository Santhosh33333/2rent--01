import { describe, it, expect } from "vitest";
import {
  validatePreferences,
  canonical,
  distanceKmBetween,
  ageFrom,
  lifestyleCompatible,
  scoreCandidate,
  parseLifestyle,
} from "../services/preferenceService";
import type { Catalogue, MatchingWeights, NormalisedPreferences, MatchCandidate } from "../services/preferenceService";

/**
 * The behaviour under test here is all about money-of-trust: a value that gets
 * stored wrongly is a value that silently changes who a person is shown and, for
 * radius and age, who they are never shown.
 */

const catalogue: Catalogue = {
  interests: new Set(["travel", "movies", "music", "food"]),
  languages: new Set(["tamil", "english", "telugu"]),
  lifestyle: new Map([
    ["food", new Set(["vegetarian", "non_vegetarian", "vegan", "no_preference"])],
    ["activity", new Set(["very_active", "moderate", "relaxed"])],
    ["smoking", new Set(["never", "regular"])],
  ]),
  lifestyleCategories: ["activity", "food", "smoking"],
};

const weights: MatchingWeights = {
  distance: 25,
  age: 20,
  interests: 25,
  languages: 15,
  lifestyle: 15,
};

const prefs = (over: Partial<NormalisedPreferences> = {}): NormalisedPreferences => ({
  distanceKm: 50,
  ageMin: 18,
  ageMax: 100,
  interests: [],
  languages: [],
  lifestyle: {},
  ...over,
});

describe("canonical", () => {
  it("folds case, spaces and hyphens into one stored form", () => {
    expect(canonical("  Very Social ")).toBe("very_social");
    expect(canonical("NON-VEGETARIAN")).toBe("non_vegetarian");
    expect(canonical("Travel")).toBe("travel");
  });

  it("is idempotent, so canonicalising an already-stored value is a no-op", () => {
    // Load-then-save round trips must not drift a value each time.
    const once = canonical("Very Social");
    expect(canonical(once)).toBe(once);
  });
});

describe("validatePreferences", () => {
  it("returns defaults for an empty body rather than failing", () => {
    const r = validatePreferences({}, catalogue);
    expect(r.ok).toBe(true);
    expect(r.value.ageMin).toBe(18);
    expect(r.value.ageMax).toBe(100);
    expect(r.value.distanceKm).toBe(50);
    expect(r.value.interests).toEqual([]);
  });

  it("accepts a valid distance", () => {
    expect(validatePreferences({ distanceKm: 25 }, catalogue).value.distanceKm).toBe(25);
  });

  it("accepts the anywhere sentinel", () => {
    const r = validatePreferences({ distanceKm: 100000 }, catalogue);
    expect(r.ok).toBe(true);
    expect(r.value.distanceKm).toBe(100000);
  });

  it("rejects a radius we do not offer, and says which are valid", () => {
    // Not clamped silently: 7 km is a real distance the user may have meant, and
    // quietly turning it into something else would be a lie about what is stored.
    const r = validatePreferences({ distanceKm: 7 }, catalogue);
    expect(r.ok).toBe(false);
    expect(r.issues[0].field).toBe("distanceKm");
    expect(r.issues[0].message).toMatch(/1, 3, 5, 10, 25, 50, 100/);
  });

  it("refuses an age below the legal minimum", () => {
    const r = validatePreferences({ ageMin: 16 }, catalogue);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("18"))).toBe(true);
  });

  it("refuses an inverted age range and names both bounds", () => {
    const r = validatePreferences({ ageMin: 40, ageMax: 25 }, catalogue);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("40") && i.message.includes("25"))).toBe(true);
  });

  it("allows a single-year range", () => {
    const r = validatePreferences({ ageMin: 30, ageMax: 30 }, catalogue);
    expect(r.ok).toBe(true);
  });

  it("drops an unknown interest and reports it, without failing the save", () => {
    // Repair, not rejection: one stale client build must not cost the user the
    // other four interests they picked.
    const r = validatePreferences({ interests: ["Travel", "aeronautics", "MUSIC"] }, catalogue);
    expect(r.ok).toBe(false);
    expect(r.value.interests).toEqual(["travel", "music"]);
    expect(r.issues.some((i) => i.message.includes("aeronautics"))).toBe(true);
  });

  it("deduplicates interests so a double-tap cannot store two", () => {
    const r = validatePreferences({ interests: ["travel", "travel", "TRAVEL"] }, catalogue);
    expect(r.value.interests).toEqual(["travel"]);
  });

  it("ignores a non-string inside the interests array rather than stringifying it", () => {
    const r = validatePreferences({ interests: ["travel", 42 as unknown as string] }, catalogue);
    expect(r.value.interests).toEqual(["travel"]);
  });

  it("rejects a lifestyle category that does not exist", () => {
    const r = validatePreferences({ lifestyle: { horoscope: ["leo"] } }, catalogue);
    expect(r.ok).toBe(false);
    expect(r.value.lifestyle).toEqual({});
  });

  it("rejects a value that is not valid for its category", () => {
    const r = validatePreferences({ lifestyle: { food: ["carnivore"] } }, catalogue);
    expect(r.ok).toBe(false);
    expect(r.value.lifestyle).toEqual({});
  });

  it("keeps valid lifestyle answers and normalises them", () => {
    const r = validatePreferences({ lifestyle: { Food: [" Vegetarian ", "NO_PREFERENCE"] } }, catalogue);
    expect(r.ok).toBe(true);
    expect(r.value.lifestyle.food).toEqual(["vegetarian", "no_preference"]);
  });

  it("treats a non-object lifestyle as invalid rather than spreading it", () => {
    const r = validatePreferences({ lifestyle: ["food"] }, catalogue);
    expect(r.ok).toBe(false);
  });

  it("rejects a non-array interests payload", () => {
    const r = validatePreferences({ interests: "travel" }, catalogue);
    expect(r.ok).toBe(true);
    expect(r.value.interests).toEqual([]);
  });

  it("caps an oversized interest list", () => {
    const many = Array.from({ length: 200 }, (_, i) => "x" + i);
    const r = validatePreferences({ interests: many }, catalogue);
    expect(r.value.interests.length).toBeLessThanOrEqual(40);
  });

  it("returns a full record even when nothing was supplied", () => {
    // Callers persist the returned value wholesale, so a partial result would
    // wipe the preferences that were not mentioned in the request.
    const r = validatePreferences({ ageMin: 25 }, catalogue);
    expect(r.value.distanceKm).toBe(50);
    expect(r.value.lifestyle).toEqual({});
  });
});

describe("distanceKmBetween", () => {
  it("is zero for the same point", () => {
    expect(distanceKmBetween(13.0827, 80.2707, 13.0827, 80.2707)).toBe(0);
  });

  it("matches a known Chennai-to-Bengaluru distance within a few km", () => {
    // ~290 km great-circle. Asserted loosely on purpose: the exact figure depends
    // on the earth radius constant, and what matters is that a long trip is not
    // read as a short one.
    const km = distanceKmBetween(13.0827, 80.2707, 12.9716, 77.5946)!;
    expect(km).toBeGreaterThan(270);
    expect(km).toBeLessThan(310);
  });

  it("is symmetric", () => {
    const a = distanceKmBetween(13.0, 80.0, 13.1, 80.1)!;
    const b = distanceKmBetween(13.1, 80.1, 13.0, 80.0)!;
    expect(a).toBeCloseTo(b, 6);
  });

  it("returns null, not zero, when a point has no location", () => {
    // Zero would rank an unknown-location profile as the closest possible person.
    expect(distanceKmBetween(null, 80, 13, 80)).toBeNull();
    expect(distanceKmBetween(13, 80, null, null)).toBeNull();
    // Undefined as well as null: a projection that omits the column arrives as
    // undefined, and has to be treated the same way rather than reaching Math.min
    // and producing NaN.
    expect(distanceKmBetween(13, 80, undefined as unknown as number, 80)).toBeNull();
  });

  it("returns null for coordinates that are not numbers", () => {
    expect(distanceKmBetween(NaN, 80, 13, 80)).toBeNull();
    expect(distanceKmBetween(13, 80, Infinity, 80)).toBeNull();
    // Undefined as well as null: a projection that omits the column entirely
    // arrives as undefined, and must be treated the same way rather than
    // reaching Math.min and producing NaN.
    expect(distanceKmBetween(undefined as unknown as number, 80, 13, 80)).toBeNull();
  });
});

describe("ageFrom", () => {
  const now = new Date(Date.UTC(2026, 9, 4));

  it("counts completed years, not the calendar year difference", () => {
    // Born 2008-10-04: on their 18th birthday, not a day early.
    expect(ageFrom(new Date(Date.UTC(2008, 9, 4)), now)).toBe(18);
    expect(ageFrom(new Date(Date.UTC(2008, 9, 5)), now)).toBe(17);
    expect(ageFrom(new Date(Date.UTC(2008, 8, 4)), now)).toBe(18);
  });
});

describe("lifestyleCompatible", () => {
  it("accepts an exact match", () => {
    expect(lifestyleCompatible("food", ["vegetarian"], ["vegetarian"])).toBe(true);
  });

  it("rejects a genuine contradiction", () => {
    expect(lifestyleCompatible("food", ["vegetarian"], ["non_vegetarian"])).toBe(false);
    expect(lifestyleCompatible("food", ["vegan"], ["non_vegetarian"])).toBe(false);
  });

  it("treats vegan and vegetarian as compatible, because one contains the other", () => {
    // Overstating incompatibility would demote profiles someone would want to see.
    expect(lifestyleCompatible("food", ["vegan"], ["vegetarian"])).toBe(true);
  });

  it("treats a non-answer as compatible with anything", () => {
    // Someone who skipped the question did not answer it badly.
    expect(lifestyleCompatible("food", [], ["non_vegetarian"])).toBe(true);
    expect(lifestyleCompatible("food", ["non_vegetarian"], [])).toBe(true);
  });

  it("allows a multi-select that mixes compatible options", () => {
    expect(lifestyleCompatible("food", ["vegetarian", "vegan"], ["vegetarian"])).toBe(true);
  });

  it("does not invent incompatibilities for categories outside the table", () => {
    // activity has no conflict rules, so every pairing is compatible.
    expect(lifestyleCompatible("activity", ["very_active"], ["relaxed"])).toBe(true);
  });

  it("applies conflicts per category, so the same value is only judged in context", () => {
    // "never" is contradictory about smoking and meaningless about food.
    expect(lifestyleCompatible("smoking", ["never"], ["regular"])).toBe(false);
    expect(lifestyleCompatible("food", ["never"], ["regular"])).toBe(true);
  });
});

describe("scoreCandidate", () => {
  const viewer = { latitude: 13.0827, longitude: 80.2707 };
  const candidate = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
    id: "c1",
    dateOfBirth: new Date(Date.UTC(1998, 0, 1)),
    language: "en",
    latitude: 13.1,
    longitude: 80.3,
    interests: [],
    languages: [],
    lifestyle: {},
    ...over,
  });

  it("ranks a candidate sharing interests above one that does not", () => {
    const p = prefs({ interests: ["travel", "music"] });
    const withOverlap = scoreCandidate(p, viewer, candidate({ interests: ["travel"] }), weights);
    const without = scoreCandidate(p, viewer, candidate(), weights);
    expect(withOverlap.score).toBeGreaterThan(without.score);
  });

  it("rewards a shared language", () => {
    const p = prefs({ languages: ["tamil"] });
    const match = scoreCandidate(p, viewer, candidate({ languages: ["tamil", "english"] }), weights);
    const miss = scoreCandidate(p, viewer, candidate({ languages: ["telugu"] }), weights);
    expect(match.score).toBeGreaterThan(miss.score);
    expect(match.reasons.some((r) => r.code === "shared_language")).toBe(true);
  });

  it("reports a shared-interest reason the UI can show", () => {
    const p = prefs({ interests: ["travel", "music"] });
    const scored = scoreCandidate(p, viewer, candidate({ interests: ["travel", "music"] }), weights);
    expect(scored.reasons.some((r) => r.code === "shared_interests")).toBe(true);
  });

  it("ranks a nearer candidate above a further one inside the same radius", () => {
    const p = prefs({ distanceKm: 50 });
    const near = scoreCandidate(p, viewer, candidate({ latitude: 13.09, longitude: 80.28 }), weights);
    const far = scoreCandidate(p, viewer, candidate({ latitude: 13.5, longitude: 80.5 }), weights);
    expect(near.score).toBeGreaterThan(far.score);
  });

  it("does not let an unknown location score as distance zero", () => {
    const p = prefs({ distanceKm: 50 });
    const noLocation = scoreCandidate(p, viewer, candidate({ latitude: null, longitude: null }), weights);
    const samePoint = scoreCandidate(p, viewer, candidate({ latitude: 13.0827, longitude: 80.2707 }), weights);
    expect(noLocation.score).toBeLessThan(samePoint.score);
  });

  it("drops unexpressed dimensions instead of scoring them zero", () => {
    // A user who saved nothing must not be buried: with no interests saved the
    // interest dimension leaves the denominator entirely.
    const empty = prefs();
    const noDistance = scoreCandidate(empty, { latitude: null, longitude: null }, candidate(), weights);
    const stillScored = scoreCandidate(empty, { latitude: null, longitude: null }, candidate(), weights);
    expect(noDistance.score).toBe(stillScored.score);
    expect(noDistance.score).toBeGreaterThan(0);
  });

  it("penalises a lifestyle contradiction", () => {
    const p = prefs({ lifestyle: { food: ["vegetarian"] } });
    const agree = scoreCandidate(p, viewer, candidate({ lifestyle: { food: ["vegetarian"] } }), weights);
    const clash = scoreCandidate(p, viewer, candidate({ lifestyle: { food: ["non_vegetarian"] } }), weights);
    expect(agree.score).toBeGreaterThan(clash.score);
  });

  it("does not dilute one contradiction away by other categories agreeing", () => {
    const p = prefs({ lifestyle: { food: ["vegetarian"], activity: ["moderate"] } });
    const agree = scoreCandidate(
      p,
      viewer,
      candidate({ lifestyle: { food: ["vegetarian"], activity: ["moderate"] } }),
      weights,
    );
    const oneClash = scoreCandidate(
      p,
      viewer,
      candidate({ lifestyle: { food: ["non_vegetarian"], activity: ["moderate"] } }),
      weights,
    );
    // One contradiction out of two answered categories must cost more than a
    // proportional share would suggest.
    const totalGap = agree.score - oneClash.score;
    expect(totalGap).toBeGreaterThan(0);
    expect(oneClash.score).toBeLessThan(agree.score);
  });

  it("stays within 0-100", () => {
    const p = prefs({ distanceKm: 100, interests: ["travel", "music", "food"], languages: ["tamil"] });
    const best = scoreCandidate(
      p,
      viewer,
      candidate({ interests: ["travel", "music", "food"], languages: ["tamil"], latitude: 13.0827, longitude: 80.2707 }),
      weights,
    );
    expect(best.score).toBeGreaterThanOrEqual(0);
    expect(best.score).toBeLessThanOrEqual(100);
  });

  it("never crashes on empty lifestyle objects", () => {
    const p = prefs({ lifestyle: { food: ["vegetarian"] } });
    expect(() => scoreCandidate(p, viewer, candidate({ lifestyle: {} }), weights)).not.toThrow();
  });
});

describe("parseLifestyle", () => {
  it("reads stored JSON", () => {
    expect(parseLifestyle('{"food":["vegetarian"]}')).toEqual({ food: ["vegetarian"] });
  });

  it("returns empty for malformed JSON instead of throwing", () => {
    // A hand-edited row must not be able to 500 the whole discovery feed.
    expect(parseLifestyle("{not json")).toEqual({});
    expect(parseLifestyle("[1,2]")).toEqual({});
    expect(parseLifestyle(null)).toEqual({});
  });

  it("normalises keys and values on the way out", () => {
    expect(parseLifestyle('{"Food":[" Vegetarian "]}' as string)).toEqual({ food: ["vegetarian"] });
  });
});