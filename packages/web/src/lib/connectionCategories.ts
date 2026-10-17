import { connectionCategoryApi, type ConnectionCategoryRow } from "./api";

/**
 * Live connection categories (client side).
 *
 * The backend already falls back to its built-in defaults while the table is
 * unseeded, but the app also needs a local copy: a network failure must never
 * leave the connection flow with nothing to show. `FALLBACK_CATEGORIES` mirrors
 * `CONNECTION_CATEGORY_DEFAULTS` in
 * `packages/backend/src/services/connectionCategoryService.ts` — keep the two
 * in step when the shipped list changes.
 *
 * Fetch once per session and share the promise, the same shape as
 * `useFeatureFlag`, so opening several screens does not re-query the catalogue.
 */
export const FALLBACK_CATEGORIES: ConnectionCategoryRow[] = [
  { key: "DATING", label: "Dating", description: "Meet someone one-to-one", chatEnabled: true, callEnabled: true, videoEnabled: false, isPaid: true, chatPricePerMinute: 0, callPricePerMinute: 1, videoPricePerMinute: 0, enabled: true, sortOrder: 10 },
  { key: "MAKE_FRIENDS", label: "Make Friends", description: "Find new people to talk to", chatEnabled: true, callEnabled: true, videoEnabled: false, isPaid: true, chatPricePerMinute: 0, callPricePerMinute: 1, videoPricePerMinute: 0, enabled: true, sortOrder: 20 },
  { key: "CASUAL_CHAT", label: "Casual Chat", description: "Light conversation, no agenda", chatEnabled: true, callEnabled: true, videoEnabled: false, isPaid: true, chatPricePerMinute: 0, callPricePerMinute: 1, videoPricePerMinute: 0, enabled: true, sortOrder: 30 },
  { key: "TIME_PASS", label: "Time Pass Speak", description: "Company while you pass the time", chatEnabled: true, callEnabled: true, videoEnabled: false, isPaid: true, chatPricePerMinute: 0, callPricePerMinute: 1, videoPricePerMinute: 0, enabled: true, sortOrder: 40 },
  { key: "BREAKUP_TALK", label: "Breakup Feelings Talk", description: "Talk through a breakup", chatEnabled: true, callEnabled: true, videoEnabled: false, isPaid: true, chatPricePerMinute: 0, callPricePerMinute: 1, videoPricePerMinute: 0, enabled: true, sortOrder: 50 },
  { key: "FEELINGS_TALK", label: "Talk About My Feelings", description: "Say what you have been holding in", chatEnabled: true, callEnabled: true, videoEnabled: false, isPaid: true, chatPricePerMinute: 0, callPricePerMinute: 1, videoPricePerMinute: 0, enabled: true, sortOrder: 60 },
  { key: "MOVIE_BUDDY", label: "Movie Buddy", description: "Find someone to watch with", chatEnabled: true, callEnabled: true, videoEnabled: false, isPaid: true, chatPricePerMinute: 0, callPricePerMinute: 1, videoPricePerMinute: 0, enabled: true, sortOrder: 70 },
  { key: "ACTIVITY_BUDDY", label: "Walking & Activity Buddy", description: "Someone for a walk or activity", chatEnabled: true, callEnabled: true, videoEnabled: false, isPaid: true, chatPricePerMinute: 0, callPricePerMinute: 1, videoPricePerMinute: 0, enabled: true, sortOrder: 80 },
  { key: "TRAVEL_BUDDY", label: "Travel Buddy", description: "Company for a trip", chatEnabled: true, callEnabled: true, videoEnabled: false, isPaid: true, chatPricePerMinute: 0, callPricePerMinute: 1, videoPricePerMinute: 0, enabled: true, sortOrder: 90 },
  { key: "OTHER", label: "Other", description: "Anything else on your mind", chatEnabled: true, callEnabled: true, videoEnabled: false, isPaid: true, chatPricePerMinute: 0, callPricePerMinute: 1, videoPricePerMinute: 0, enabled: true, sortOrder: 100 },
];

let cache: ConnectionCategoryRow[] | null = null;
let inflight: Promise<ConnectionCategoryRow[]> | null = null;

export function fetchConnectionCategories(): Promise<ConnectionCategoryRow[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = connectionCategoryApi
      .list()
      .then((res) => {
        const items = res.data?.data?.items;
        cache = Array.isArray(items) && items.length > 0 ? items : FALLBACK_CATEGORIES;
        return cache;
      })
      .catch(() => {
        // Unreachable backend: the shipped list is still a truthful catalogue,
        // it just may not include an admin's newest edit.
        cache = FALLBACK_CATEGORIES;
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Test seam / sign-out reset. */
export function resetConnectionCategoryCache(): void {
  cache = null;
  inflight = null;
}
