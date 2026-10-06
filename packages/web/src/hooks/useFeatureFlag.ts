import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { PublicFlagRow } from "../types/post";

// Mirror of the backend's seeded module flags. The endpoint only returns
// ENABLED flags, so a missing key means "off".
const KNOWN_FLAGS = [
  "POSTS",
  "GIFTING",
  "SAVED",
  "REACTIONS",
  "STORIES",
  "SHORT_VIDEOS",
  "TRAVEL",
  "CREATOR_MODE",
  "BUSINESS_PROFILES",
  "LIVE_EVENTS",
  "LIVE_STREAMING",
  "AI_ASSISTANT",
  "LOCAL_DISCOVERY",
];

export interface FeatureFlagState {
  key: string;
  isEnabled: boolean;
}

let cache: FeatureFlagState[] | null = null;
let inflight: Promise<FeatureFlagState[]> | null = null;

// One fetch shared by every caller in this session, so the flag catalogue is
// queried once instead of once per page mount.
export function fetchFeatureFlags(): Promise<FeatureFlagState[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .get<{ data?: PublicFlagRow[] }>("/content/feature-flags")
      .then((res) => {
        const list = res.data?.data;
        const enabled = new Set(
          Array.isArray(list) ? list.filter((f) => f.isEnabled).map((f) => f.key) : []
        );
        cache = KNOWN_FLAGS.map((key) => ({ key, isEnabled: enabled.has(key) }));
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Read one module flag at runtime. `fallback` is what the feature behaves as
 * when the flag fetch is unreachable — shipped modules pass `true` so a
 * transient network failure never hides an existing feature.
 */
export function useFeatureFlag(key: string, fallback: boolean): boolean {
  const [state, setState] = useState<FeatureFlagState[] | null>(cache);

  useEffect(() => {
    let alive = true;
    fetchFeatureFlags()
      .then((flags) => {
        if (alive) setState(flags);
      })
      .catch(() => {
        // Unreachable backend: leave state null and fall through to `fallback`.
      });
    return () => {
      alive = false;
    };
  }, []);

  const flag = state?.find((f) => f.key === key);
  return flag ? flag.isEnabled : fallback;
}