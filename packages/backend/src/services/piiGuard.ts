// Personal-data guard for user-authored text.
//
// The product rule is that members do not exchange personal contact details
// inside the app or on an in-app call - the relationship stays on Nabri, and
// nobody can be pressured into moving to an unmoderated channel. Voice calls
// carry no text, so this guard is the enforceable surface.
//
// It now covers every path where text reaches another person or leaves the
// app: 1:1 messages, group messages, chat-request notes, event threads, feed
// posts and comments, community posts, comments and polls, and the text handed
// to the AI endpoints (the assistant, the agent, translation and drafting - all
// of which forward it to a model provider). One rule, one refusal, wherever the
// text is authored.
//
// It detects contact details, not "sensitive words": phone numbers, email
// addresses, links/domains, @handles and a small set of messaging-platform
// names. It deliberately avoids common-English tokens (e.g. "signal", "snap")
// that would block ordinary sentences.

export type PiiCategory = "PHONE" | "EMAIL" | "LINK" | "HANDLE" | "PLATFORM";

export interface PiiFinding {
  category: PiiCategory;
  /** The offending substring, trimmed, for logging/diagnostics. Never shown raw to the other user. */
  sample: string;
}

/** Shown to the sender when a message is refused. One wording, one code. */
export const PERSONAL_DATA_ERROR_CODE = "PII_NOT_ALLOWED";
export const PERSONAL_DATA_ERROR_MESSAGE =
  "For everyone's safety, you can't share phone numbers, email addresses, links or social handles here.";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+/i;
// A bare domain is also a link ("instagram.com/jane"). Common TLDs only, so a
// sentence ending in a normal word never matches.
const DOMAIN_RE = /\b[a-z0-9-]+\.(?:com|in|net|org|io|co|me|app|xyz|info|biz|live|site|online|link)\b/i;
// @handle, optionally preceded by a platform word ("my insta @jane").
const HANDLE_RE = /(?:^|\s)@[a-z0-9_.]{3,}/i;
// Explicit platform names. Kept narrow on purpose.
const PLATFORM_RE = /\b(?:whatsapp|telegram|instagram|snapchat|discord)\b/i;

/**
 * Return the first piece of personal data found in `text`, or null when there
 * is none. Order matters: the most specific/least ambiguous patterns first.
 */
export function findPersonalData(text: string): PiiFinding | null {
  if (!text) return null;

  const email = text.match(EMAIL_RE);
  if (email) return { category: "EMAIL", sample: email[0] };

  const url = text.match(URL_RE);
  if (url) return { category: "LINK", sample: url[0] };

  // Phone: a run that may contain separators, but must contain at least 10
  // digits once separators are stripped (Indian mobile numbers are 10 digits,
  // international ones are longer). This is what stops "meet at 5" matching.
  const candidates = text.match(/\+?\d[\d\s().-]{7,}\d/g) || [];
  for (const candidate of candidates) {
    if (candidate.replace(/\D/g, "").length >= 10) {
      return { category: "PHONE", sample: candidate.trim() };
    }
  }

  const domain = text.match(DOMAIN_RE);
  if (domain) return { category: "LINK", sample: domain[0] };

  const handle = text.match(HANDLE_RE);
  if (handle) return { category: "HANDLE", sample: handle[0].trim() };

  const platform = text.match(PLATFORM_RE);
  if (platform) return { category: "PLATFORM", sample: platform[0] };

  return null;
}

/** Convenience boolean for callers that only need a yes/no. */
export function containsPersonalData(text: string): boolean {
  return findPersonalData(text) !== null;
}
