import { api } from "../../lib/api";

export type SwipeType = "LIKE" | "PASS" | "SUPER_LIKE";

/** A short, user-facing explanation of why a profile ranked where it did. */
export interface MatchReason {
  code: string;
  label: string;
}

export interface DiscoverProfile {
  id: string;
  fullName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
  gender?: string | null;
  /**
   * Age in whole years, computed server-side. The raw date of birth is
   * deliberately not sent: it is more precise than anything a card needs and a
   * birth date identifies people far more strongly than an age does.
   */
  age?: number | null;
  language?: string | null;
  mobileVerified?: boolean;
  /** Approximate band ("1-5 km"), never a precise figure. Null when unknown. */
  distance?: string | null;
  /** 0-100. Internal ranking detail; not the main thing to show a user. */
  matchScore?: number;
  reasons?: MatchReason[];
}

export interface Match {
  id: string;
  matchedAt: string;
  lastMessageAt?: string | null;
  userA: Pick<DiscoverProfile, "id" | "fullName" | "avatarUrl">;
  userB: Pick<DiscoverProfile, "id" | "fullName" | "avatarUrl">;
}

export interface SwipeResponse {
  swipe: SwipeType;
  match: { id: string; matchedAt: string } | null;
  isMatch: boolean;
}

/**
 * Per-request filters for one discovery call.
 *
 * Every field is optional and omitting one means "use my saved preference for
 * this". Sending an explicit value overrides the saved preference for this one
 * request only - which is what makes a temporary "just Chennai this time" filter
 * possible without editing and re-saving the preference form.
 */
export interface DiscoverFilters {
  minAge?: number;
  maxAge?: number;
  city?: string;
  gender?: string;
  limit?: number;
}

export interface DiscoverResponse {
  results: DiscoverProfile[];
  count: number;
  /** Candidates that passed the filters, before the limit was applied. */
  totalEligible: number;
  /** True when the ranking window was full, so the feed may be shallower than it looks. */
  windowTruncated: boolean;
}

/**
 * Fetch the discovery feed.
 *
 * Returns the whole envelope rather than just the array: the caller needs
 * `totalEligible` to tell "nobody matches yet" apart from "showing you 5 of 200",
 * which are very different messages and look identical if you only pass the list
 * along.
 */
export async function fetchDiscover(
  filters: DiscoverFilters = {},
  signal?: AbortSignal,
): Promise<DiscoverResponse> {
  const { data } = await api.get<{ data: DiscoverResponse }>("/dating/discover", {
    params: filters,
    signal,
  });
  return data.data;
}

export async function sendSwipe(targetUserId: string, type: SwipeType) {
  const { data } = await api.post<{ data: SwipeResponse }>("/dating/swipe", {
    targetUserId,
    type,
  });
  return data.data;
}

export async function fetchMatches() {
  const { data } = await api.get<{ data: { results: Match[] } }>("/dating/matches");
  return data.data.results;
}

export function ageFrom(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}