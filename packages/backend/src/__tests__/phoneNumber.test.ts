import { describe, it, expect } from "vitest";
import {
  INDIA_DIAL_CODE,
  INDIAN_MOBILE_LENGTH,
  normaliseIndianPhone,
  phoneLookupCandidates,
  phoneMatches,
} from "../services/phoneNumber";

/**
 * Phone parsing.
 *
 * The stakes are asymmetric, so the tests lean on the failure cases:
 *
 *  - A number wrongly REJECTED locks a real person out of their account. That is
 *    the expensive mistake, because there is no recovery path once the only
 *    account identifier is refused.
 *  - A number wrongly ACCEPTED lets someone register with a number they do not
 *    own, which is fraud-adjacent and also blocks the real owner later.
 *
 * So every accepted spelling is enumerated, and the boundary between "correctly
 * rejected" and "wrongly rejected" is pinned deliberately - especially the
 * `91...` case, where a plausible-looking rule silently routes a caller's money
 * to the wrong account.
 *
 * FIXTURE NOTE: the sample below is deliberately NOT a tidy pattern. The obvious
 * choice, `9876543210`, is a strictly descending run and is therefore a
 * placeholder the parser is supposed to reject - so using it as the "this is a
 * normal number" fixture would have every acceptance test fail for the right
 * reason and the wrong one at the same time.
 */

/** An ordinary, valid Indian mobile number. */
const REAL = "9820012345";
const REAL_E164 = "+919820012345";

const ok = (v: unknown) => {
  const r = normaliseIndianPhone(v);
  if (!r.ok) throw new Error(`expected ${String(v)} to be accepted, got: ${r.message}`);
  return r;
};

const code = (v: unknown) => {
  const r = normaliseIndianPhone(v);
  if (r.ok) throw new Error(`expected ${String(v)} to be rejected, got ${r.e164}`);
  return r.reason;
};

describe("accepted spellings of the same number", () => {
  it("accepts a plain 10-digit number", () => {
    expect(ok(REAL)).toEqual({ ok: true, e164: REAL_E164, local: REAL });
  });

  it("accepts +91 with the country code", () => {
    expect(ok(`+91${REAL}`).e164).toBe(REAL_E164);
  });

  it("accepts 91 with no plus sign", () => {
    expect(ok(`91${REAL}`).e164).toBe(REAL_E164);
  });

  it("accepts the Indian trunk prefix 0", () => {
    expect(ok(`0${REAL}`).e164).toBe(REAL_E164);
  });

  it("strips spaces, dashes, dots and brackets", () => {
    expect(ok("+91 98200 12345").e164).toBe(REAL_E164);
    expect(ok("98200-12345").e164).toBe(REAL_E164);
    expect(ok("98200.12345").e164).toBe(REAL_E164);
    expect(ok("(98200) 12345").e164).toBe(REAL_E164);
    expect(ok(`  ${REAL}  `).e164).toBe(REAL_E164);
  });

  it("returns the same canonical value for every spelling", () => {
    const forms = [
      REAL,
      `+91${REAL}`,
      `91${REAL}`,
      `0${REAL}`,
      "+91 98200 12345",
      "98200-12345",
    ];
    const canonical = new Set(forms.map((f) => ok(f).e164));
    // One distinct value, or two people with the same number become two accounts.
    expect(canonical.size).toBe(1);
  });

  it("accepts numbers starting 6, 7, 8 and 9", () => {
    expect(ok("6123456780").ok).toBe(true);
    expect(ok("7123456780").ok).toBe(true);
    expect(ok("8123456780").ok).toBe(true);
    expect(ok("9123456780").ok).toBe(true);
  });

  it("preserves the number exactly - no reordering or truncation", () => {
    // Silent digit dropping is how one person's payment reaches another account.
    expect(ok(REAL).local).toBe(REAL);
    expect(ok("+91 98200 12345").local).toBe(REAL);
    expect(ok("+919820012345").local).toBe(REAL);
  });
});

describe("the ambiguous 91 prefix", () => {
  it("treats a 10-digit number starting 91 as a LOCAL number", () => {
    // `9123456780` is a real, dialable number. Stripping its 91 would leave eight
    // digits and silently produce the wrong account.
    expect(ok("9123456780").local).toBe("9123456780");
  });

  it("strips 91 only when exactly ten digits remain", () => {
    expect(ok(`91${REAL}`).local).toBe(REAL);
  });

  it("rejects a 91 prefix that would leave too few digits", () => {
    // 91 + 8 digits is not a complete number. Guessing the missing digits is not
    // an option, so it is refused.
    expect(code("919820012")).toBe("PHONE_WRONG_LENGTH");
  });

  it("reads an explicit + as a country code even when the total is 10 digits", () => {
    // The dangerous case. `+9198200123` is a user writing 91 followed by eight
    // digits - an incomplete number. Reinterpreting it as the LOCAL number
    // 9198200123 would silently attach the account to a different person, and
    // the user would never see an error.
    expect(code("+9198200123")).toBe("PHONE_WRONG_LENGTH");
  });

  it("still reads a bare 91 prefix as local when nothing marks it as a code", () => {
    // Same digits, no '+': there is no signal that a country code was intended,
    // so the local reading stands. This is the case that must NOT be rejected.
    expect(ok("9198200123").local).toBe("9198200123");
  });
});

describe("rejections", () => {
  it("rejects nothing", () => {
    expect(code("")).toBe("PHONE_REQUIRED");
    expect(code("   ")).toBe("PHONE_REQUIRED");
    expect(code(null)).toBe("PHONE_REQUIRED");
    expect(code(undefined)).toBe("PHONE_REQUIRED");
  });

  it("rejects letters and other junk", () => {
    expect(code("abcdefghij")).toBe("PHONE_NOT_NUMERIC");
    expect(code("98200abcde")).toBe("PHONE_NOT_NUMERIC");
    expect(code("9820012345/1234")).toBe("PHONE_NOT_NUMERIC");
  });

  it("rejects a plus sign that is not at the start", () => {
    expect(code("98+20012345")).toBe("PHONE_NOT_NUMERIC");
  });

  it("rejects more than one plus sign", () => {
    expect(code("++919820012345")).toBe("PHONE_NOT_NUMERIC");
  });

  it("rejects the wrong length", () => {
    expect(code("982001234")).toBe("PHONE_WRONG_LENGTH"); // 9
    expect(code("98200123451")).toBe("PHONE_WRONG_LENGTH"); // 11
    expect(code("123456789012345")).toBe("PHONE_WRONG_LENGTH");
  });

  it("rejects numbers that cannot be an Indian mobile", () => {
    // 1-5 series are landline / STD allocations and cannot receive SMS, which is
    // the only reason this number exists in the system.
    expect(code("1823456780")).toBe("PHONE_BAD_PREFIX");
    expect(code("5123456780")).toBe("PHONE_BAD_PREFIX");
  });

  it("names the sample-number problem rather than blaming the prefix", () => {
    // Both of these also fail the 6-9 prefix test. Telling someone who typed a
    // sample that their LEADING DIGIT is wrong sends them off to fix the one
    // thing that was never the problem. The specific diagnosis has to win.
    expect(code("1234567890")).toBe("PHONE_PLACEHOLDER");
    expect(code("1111111111")).toBe("PHONE_PLACEHOLDER");
  });

  it("names a foreign country code rather than blaming the length", () => {
    // The user is not holding a length problem, so telling them about length
    // sends them off to count digits instead of removing the +1.
    expect(code("+14155552671")).toBe("PHONE_FOREIGN");
    expect(code("+447700900123")).toBe("PHONE_FOREIGN");
  });
});

describe("placeholder numbers are refused", () => {
  it("refuses a number where every digit is the same", () => {
    expect(code("1111111111")).toBe("PHONE_PLACEHOLDER");
    expect(code("9999999999")).toBe("PHONE_PLACEHOLDER");
    expect(code("+916666666666")).toBe("PHONE_PLACEHOLDER");
  });

  it("refuses a run counting up", () => {
    expect(code("1234567890")).toBe("PHONE_PLACEHOLDER");
  });

  it("refuses a run that wraps past nine", () => {
    // Digit sequences wrap: 8,9,0,1,2,3,4,5,6,7 is a run just as much as
    // 1,2,3,4,5,6,7,8,9,0 is. A raw character-code comparison sees the 9-to-0
    // step as a jump of -9 and lets the whole family through.
    expect(code("8901234567")).toBe("PHONE_PLACEHOLDER");
    expect(code("9012345678")).toBe("PHONE_PLACEHOLDER");
    expect(code("2345678901")).toBe("PHONE_PLACEHOLDER");
    expect(code("3456789012")).toBe("PHONE_PLACEHOLDER");
  });

  it("refuses a run counting down", () => {
    // This is the number most people type when they mean "give me an example".
    expect(code("9876543210")).toBe("PHONE_PLACEHOLDER");
    expect(code("1098765432")).toBe("PHONE_PLACEHOLDER");
  });

  it("still accepts a number that merely LOOKS similar to a run", () => {
    // `9876543211`..`9876543215` are the numbers several seeded internal accounts
    // already use. They are not strictly sequential, so this rule must not lock
    // out accounts that already exist.
    expect(ok("9876543211").ok).toBe(true);
    expect(ok("9876543215").ok).toBe(true);
    // A single digit out of place is enough to make it a real number.
    expect(ok("9876544210").ok).toBe(true);
  });

  it("does NOT apply the placeholder rule during a lookup", () => {
    // Someone who already holds an account with such a number must still be able
    // to sign in, AND that row may be stored in E.164 form from before this rule
    // existed. If the lookup reused the entry rule it would refuse to canonicalise
    // the input, never emit +919876543210, and the account would be unreachable.
    // Rejection is for ENTRY only.
    const candidates = phoneLookupCandidates("9876543210");
    expect(candidates).toContain("+919876543210");
    expect(candidates).toContain("9876543210");
  });

  it("keeps lookup and entry rules from drifting apart", () => {
    // Every number the entry rule accepts must be findable by typing it, and
    // every number it rejects on placeholder grounds must still resolve. If these
    // two ever disagree, a user can sign up and then be unable to sign in.
    for (const form of [REAL, REAL_E164, `0${REAL}`, "9876543210", "1111111111", "9999999999"]) {
      expect(phoneLookupCandidates(form).length).toBeGreaterThan(0);
      expect(phoneLookupCandidates(form)).toContain(form.replace(/\D/g, "").slice(-10) || form);
    }
  });
});

describe("phoneMatches - the profile / KYC consistency check", () => {
  it("matches two spellings of the same number", () => {
    expect(phoneMatches(REAL, REAL_E164)).toBe(true);
    expect(phoneMatches(REAL, `0${REAL}`)).toBe(true);
    expect(phoneMatches("+91 98200 12345", "98200-12345")).toBe(true);
  });

  it("does not match different numbers", () => {
    expect(phoneMatches(REAL, "9820012346")).toBe(false);
    expect(phoneMatches(REAL, "9123456780")).toBe(false);
  });

  it("never treats two unusable values as a match", () => {
    // This is the failure that matters: `abc` === `abc` would report "the numbers
    // match" and wave through a KYC whose phone was never a phone at all.
    expect(phoneMatches("not-a-number", "not-a-number")).toBe(false);
    expect(phoneMatches("", "")).toBe(false);
    expect(phoneMatches(null, null)).toBe(false);
    expect(phoneMatches(REAL, "not-a-number")).toBe(false);
    expect(phoneMatches(REAL, "982001234")).toBe(false);
    // And the case that motivates the whole check: a placeholder must not be able
    // to satisfy it either.
    expect(phoneMatches("9876543210", "9876543210")).toBe(false);
  });

  it("is symmetric", () => {
    expect(phoneMatches(REAL, REAL_E164)).toBe(phoneMatches(REAL_E164, REAL));
  });
});

describe("lookup candidates", () => {
  it("offers the canonical form first", () => {
    expect(phoneLookupCandidates(REAL)[0]).toBe(REAL_E164);
  });

  it("covers the legacy shapes so nobody is locked out during the change", () => {
    // Rows written before this module exist in whatever format the client sent.
    // All of these must resolve the same account.
    const sets = [REAL, REAL_E164, `0${REAL}`, "98200-12345"].map(phoneLookupCandidates);
    for (const s of sets) expect(s).toContain(REAL_E164);
    for (const s of sets) expect(s).toContain(REAL);
  });

  it("includes the raw input so an unmatched legacy row is still found", () => {
    expect(phoneLookupCandidates("009820012345")).toContain("009820012345");
  });

  it("never returns duplicates", () => {
    const c = phoneLookupCandidates(REAL);
    expect(new Set(c).size).toBe(c.length);
  });

  it("stays short enough to be safe in a SQL OR clause", () => {
    // This list goes into a query. An unbounded result derived from user input
    // is how a lookup becomes a table scan.
    for (const input of [REAL, "+91 98200 12345", "x".repeat(500)]) {
      expect(phoneLookupCandidates(input).length).toBeLessThanOrEqual(6);
    }
  });

  it("returns nothing usable for junk rather than throwing", () => {
    expect(() => phoneLookupCandidates(undefined)).not.toThrow();
    expect(() => phoneLookupCandidates({})).not.toThrow();
  });
});

describe("constants", () => {
  it("pins the country code and length the app promises users", () => {
    expect(INDIA_DIAL_CODE).toBe("+91");
    expect(INDIAN_MOBILE_LENGTH).toBe(10);
  });
});