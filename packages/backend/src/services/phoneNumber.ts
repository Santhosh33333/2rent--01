/**
 * Indian phone numbers, in one place.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phone validation was scattered and inconsistent before this module:
 *
 *   - register accepted `isMobilePhone("any")`, i.e. any country's format, and
 *     stored whatever the client typed;
 *   - login resolved the identifier with an EXACT string match
 *     (`OR: [{ email }, { phone: loginIdentifier }]`), so an account stored as
 *     `+919876543211` could not be reached by typing `9876543211`;
 *   - the admin phone editor accepted any 10-15 character string, including
 *     `abcdefghij`;
 *   - the KYC emergency-contact field used `isMobilePhone("any")` again.
 *
 * Four different rules, so a number accepted in one place could be rejected in
 * another, and the same person could be "reachable on +919876543211" and
 * "unreachable on 9876543211".
 *
 * THE STORED FORMAT
 * -----------------
 * `+91XXXXXXXXXX` (E.164). Not a choice made here: the six real accounts in the
 * live database already store exactly this, so normalising to it keeps existing
 * users reachable instead of silently stranding them.
 *
 * WHAT USERS TYPE
 * ---------------
 * Ten digits. `+91` is the country's code, not something an Indian user should
 * have to type, so every reasonable spelling of it is accepted on input and
 * stripped. Users are NOT asked to reformat their own number.
 *
 * THE AMBIGUOUS CASE, HANDLED EXPLICITLY
 * --------------------------------------
 * `9123456789` is genuinely ambiguous: it is either the local number starting 91,
 * or the country code 91 followed by the 8-digit number 23456789. Guessing wrong
 * would silently attach someone's payment to the wrong account. The rule here is
 * that a leading `91` is only treated as the country code when what remains is
 * exactly 10 digits. Otherwise it is part of the local number. So:
 *
 *     9123456789   -> 9123456789  (local, valid - a number may start 91)
 *     919876543210 -> 9876543210  (country code, valid)
 *     91987654321  -> rejected, 8 digits would remain
 */

/** India's dialling code in E.164 form. */
export const INDIA_DIAL_CODE = "+91";

/** An Indian mobile number is ten digits, after the country code. */
export const INDIAN_MOBILE_LENGTH = 10;

/**
 * A valid Indian mobile begins 6-9.
 *
 * Indian mobile numbers are allocated in the 6, 7, 8 and 9 series. Accepting
 * 0-5 would admit landline and STD codes, which cannot receive the OTP or
 * account-recovery SMS this number is used for, so a number that passes
 * validation but cannot be texted is worse than a rejected one: the user
 * discovers the problem only after waiting for a code that will never arrive.
 */
const VALID_MOBILE_PREFIX = /^[6-9]/;

/**
 * Numbers that are obviously typed rather than dialled.
 *
 * `9999999999` and `1234567890` satisfy every structural rule above, so without
 * this they register happily - and then that account owns a phone number nobody
 * can be reached on, which matters here because the number is the only route to
 * account recovery and to any SMS the platform sends.
 *
 * Three shapes are caught:
 *   - every digit the same            1111111111
 *   - a run counting up                1234567890
 *   - a run counting down              9876543210
 *
 * RUNS WRAP AROUND. Digit sequences are compared modulo ten, not by raw value,
 * because a run does not stop at nine: `8901234567` is 8,9,0,1,2,3,4,5,6,7 and
 * is just as obviously typed as `1234567890`. Comparing character codes treats
 * the 9-to-0 step as a jump of -9 and waves the whole family through.
 *
 * Only complete runs are rejected. `9876543211` - which is the pattern several
 * seeded internal accounts already use - breaks its run at the last digit, so it
 * stays valid and this rule cannot lock out an account that already exists. The
 * odds of a real number being a full ten-digit run are about one in 500 million.
 *
 * This applies on ENTRY only. `phoneLookupCandidates` never calls it, so a user
 * whose number happens to trip one of these patterns can still sign in to the
 * account they already hold.
 */
function looksLikePlaceholder(digits: string): boolean {
  if (/^(\d)\1+$/.test(digits)) return true; // 1111111111

  const up = (prev: number, next: number) => (prev + 1) % 10 === next;
  const down = (prev: number, next: number) => (prev + 9) % 10 === next; // (prev - 1) mod 10

  let ascending = true;
  let descending = true;
  for (let i = 1; i < digits.length; i += 1) {
    const prev = digits.charCodeAt(i - 1) - 48;
    const next = digits.charCodeAt(i) - 48;
    if (!up(prev, next)) ascending = false;
    if (!down(prev, next)) descending = false;
  }
  return ascending || descending;
}

export type PhoneRejection =
  | "PHONE_REQUIRED"
  | "PHONE_NOT_NUMERIC"
  | "PHONE_WRONG_LENGTH"
  | "PHONE_BAD_PREFIX"
  | "PHONE_PLACEHOLDER"
  | "PHONE_FOREIGN";

export type PhoneResult =
  | { ok: true; e164: string; local: string }
  | { ok: false; reason: PhoneRejection; message: string };

function reject(reason: PhoneRejection, message: string): PhoneResult {
  return { ok: false, reason, message };
}

/**
 * Parse any reasonable way of writing an Indian mobile number.
 *
 * Accepts: `9876543210`, `+919876543210`, `919876543210`, `09876543210`,
 * `+91 98765 43210`, `(98765) 43210`, `987-654-3210`, `987.654.3210`.
 *
 * Never throws and never returns a partially-valid result: on failure `ok` is
 * false with a reason code and a message written to be shown to a user as-is.
 *
 * This is the ENTRY rule and it refuses sample numbers. `phoneLookupCandidates`
 * uses the same parser with `allowPlaceholder`, because refusing a number
 * somebody already holds an account on is the one outcome this module must never
 * produce.
 */
export function normaliseIndianPhone(input: unknown): PhoneResult {
  return parsePhone(input, { allowPlaceholder: false });
}

/**
 * The single implementation behind both entry and lookup.
 *
 * One parser, not two. The only difference between registering a number and
 * finding an existing one is whether a sample-looking value is tolerated, and
 * two separate implementations of the same format rules would inevitably drift
 * apart - at which point a number accepted at signup stops being findable at
 * login, which is the precise bug this module exists to remove.
 */
function parsePhone(
  input: unknown,
  opts: { allowPlaceholder: boolean },
): PhoneResult {
  if (input === null || input === undefined) {
    return reject("PHONE_REQUIRED", "Enter your 10-digit mobile number.");
  }

  const raw = String(input).trim();
  if (!raw) return reject("PHONE_REQUIRED", "Enter your 10-digit mobile number.");

  // Keep only digits plus at most one leading '+'. Anything else (letters,
  // slashes, several signs) is a typo or an attempt to smuggle a value past the
  // length check, and both deserve the same clear refusal.
  if (/[^0-9+\s\-().]/.test(raw)) {
    return reject("PHONE_NOT_NUMERIC", "A mobile number can only contain digits, spaces and + - ( ).");
  }
  const plusCount = (raw.match(/\+/g) || []).length;
  if (plusCount > 1 || (plusCount === 1 && !/^\s*\+/.test(raw))) {
    return reject("PHONE_NOT_NUMERIC", "Put the + sign at the very start, like +91 9876543210.");
  }

  const hadPlus = /^\s*\+/.test(raw);
  let digits = raw.replace(/\D/g, "");

  // A '+' with a country code that is not 91 is a real foreign number, and
  // saying so is far more useful than "wrong length" - the user is not going to
  // fix a length problem they do not have.
  if (hadPlus && !/^91/.test(digits)) {
    return reject(
      "PHONE_FOREIGN",
      "This app is for Indian mobile numbers only. Enter your number without the country code.",
    );
  }

  // An explicit '+' is the user telling us a country code is present, so the
  // leading 91 is a country code no matter what follows it. `+9198200123` is 91
  // plus only eight digits - an incomplete number - and must be refused as the
  // wrong length it plainly is, rather than being quietly reinterpreted as the
  // local number 9198200123. Treating those two as the same number would let a
  // truncated entry pass and then attach the account to a different person.
  //
  // Without a '+' the 91 is ambiguous, so it is only stripped when exactly ten
  // digits remain. See the header for why a bare `9123456789` is a local number.
  if (/^91/.test(digits) && (hadPlus || digits.length > INDIAN_MOBILE_LENGTH)) {
    digits = digits.slice(2);
  }

  // Indian trunk prefix: 09876543210 is how the number is written when dialled
  // from inside India. Strip one leading zero, and only one.
  if (digits.length === INDIAN_MOBILE_LENGTH + 1 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (digits.length !== INDIAN_MOBILE_LENGTH) {
    return reject(
      "PHONE_WRONG_LENGTH",
      `A mobile number is ${INDIAN_MOBILE_LENGTH} digits. You entered ${digits.length}.`,
    );
  }
  // Order is deliberate. A typed-in sample like 1234567890 or 1111111111 also
  // fails the 6-9 prefix test, but "Indian mobile numbers start with 6, 7, 8 or
  // 9" is the wrong thing to tell someone who typed a sample - it sends them off
  // to fix a leading digit that was never the problem. The sample diagnosis is
  // the specific one, so it is checked first.
  //
  // Skipped entirely during a lookup: a sample-looking number is refused when
  // someone tries to CLAIM it, but it must still resolve when someone tries to
  // SIGN IN to the account that already holds it.
  if (!opts.allowPlaceholder && looksLikePlaceholder(digits)) {
    return reject(
      "PHONE_PLACEHOLDER",
      "That looks like a sample number rather than a real mobile. Enter the number you actually use.",
    );
  }
  if (!VALID_MOBILE_PREFIX.test(digits)) {
    return reject(
      "PHONE_BAD_PREFIX",
      "Indian mobile numbers start with 6, 7, 8 or 9. Please check the number.",
    );
  }

  return { ok: true, e164: `${INDIA_DIAL_CODE}${digits}`, local: digits };
}

/**
 * Turn a rejection into the `{ message, code }` pair an HTTP layer needs.
 *
 * Kept here, and free of any Express dependency, so that every endpoint reports
 * the identical message and machine-readable code for the identical problem. The
 * alternative - hand-writing the sendError call at each of the five or six entry
 * points - drifts within a release: one endpoint returns PHONE_WRONG_LENGTH,
 * the next returns a generic VALIDATION_ERROR, and the client cannot special-case
 * either.
 */
export function phoneErrorBody(
  result: PhoneResult,
): { message: string; code: string } {
  if (result.ok) {
    // Defensive: a caller passing a success in by mistake must not be handed a
    // fabricated error that blames a number which is actually valid.
    return { message: "Invalid mobile number.", code: "VALIDATION_ERROR" };
  }
  return { message: result.message, code: result.reason };
}

/**
 * Do two independently-typed numbers refer to the same person?
 *
 * This is the check behind "the profile number and the KYC number must match".
 * It normalises BOTH sides rather than comparing strings, so `9876543210` on one
 * form and `+91 98765 43210` on the other are correctly treated as the same.
 *
 * An unparseable value never matches - not even another unparseable value.
 * Comparing two garbage strings with `===` would let `abc123` and `abc123`
 * "match", which is exactly the kind of false confirmation this check exists to
 * prevent.
 *
 * Strict on purpose: this runs on ENTRY values, including the KYC declaration,
 * so a sample number cannot satisfy it. Signing in is the tolerant path
 * (`phoneLookupCandidates`).
 */
export function phoneMatches(a: unknown, b: unknown): boolean {
  const left = normaliseIndianPhone(a);
  const right = normaliseIndianPhone(b);
  return left.ok && right.ok && left.e164 === right.e164;
}

/**
 * The values a phone lookup should try, most specific first.
 *
 * Login used to be an exact string match, which only worked if the user typed
 * the number in precisely the format it was stored in. Returning a small set of
 * equivalent spellings keeps every legacy row reachable during the transition
 * without needing a data migration: `+919876543210` and `9876543210` both resolve,
 * so an account stored in either shape still signs in.
 *
 * Capped in length on purpose - this value goes into a SQL `OR` clause, and an
 * unbounded list built from user input is how a lookup turns into a slow scan.
 */
export function phoneLookupCandidates(input: unknown): string[] {
  const out: string[] = [];
  const push = (v: string | undefined | null) => {
    const t = (v ?? "").trim();
    if (t && t.length <= 20 && !out.includes(t)) out.push(t);
  };

  const parsed = parsePhone(input, { allowPlaceholder: true });
  if (parsed.ok) {
    push(parsed.e164);
    push(parsed.local);
  }
  // The raw input, so a row stored in a shape this normaliser does not produce
  // (older data, an imported list) is still found rather than locked out.
  push(typeof input === "string" ? input : undefined);

  const digits = typeof input === "string" ? input.replace(/\D/g, "") : "";
  if (digits) {
    push(`+${digits}`);
    push(`91${digits}`);
  }
  return out;
}