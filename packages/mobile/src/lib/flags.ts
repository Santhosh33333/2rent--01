import { useQuery } from '@tanstack/react-query';
import { get } from './api';

// The public flag catalogue mirrors what the backend seeded for the spec's
// module list (prisma/migrations/.../migration.sql). The endpoint only returns
// flags that are ENABLED, so a missing key means "off".
const KNOWN_FLAGS = [
  'POSTS',
  'GIFTING',
  'SAVED',
  'REACTIONS',
  'STORIES',
  'SHORT_VIDEOS',
  'TRAVEL',
  'CREATOR_MODE',
  'BUSINESS_PROFILES',
  'LIVE_EVENTS',
  'LIVE_STREAMING',
  'AI_ASSISTANT',
  'LOCAL_DISCOVERY',
];

export interface FeatureFlagState {
  key: string;
  isEnabled: boolean;
}

interface PublicFlagRow {
  key: string;
  isEnabled: boolean;
  rolloutPercentage: number;
}

async function fetchFlags(): Promise<FeatureFlagState[]> {
  const envelope = await get<PublicFlagRow[]>('/content/feature-flags');
  const enabled = new Set(
    Array.isArray(envelope.data) ? envelope.data.filter((f) => f.isEnabled).map((f) => f.key) : []
  );
  return KNOWN_FLAGS.map((key) => ({ key, isEnabled: enabled.has(key) }));
}

const flagCache = new Map<string, Promise<FeatureFlagState[]>>();

// One-fetch-per-keyspace helper so screens sharing the flag set don't each hit
// the network on mount.
export async function loadFlags(): Promise<FeatureFlagState[]> {
  if (!flagCache.has('all')) {
    flagCache.set(
      'all',
      fetchFlags().catch((err) => {
        flagCache.delete('all');
        throw err;
      })
    );
  }
  return flagCache.get('all')!;
}

export function useFeatureFlags() {
  return useQuery({
    queryKey: ['feature-flags'],
    queryFn: loadFlags,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Read one flag. `fallback` is what the feature behaves as when the fetch is
 * unreachable — for already-shipped modules callers pass true so an offline
 * device doesn't bake the feature away.
 */
export function useFlag(key: string, fallback = false): boolean {
  const { data } = useFeatureFlags();
  const flag = data?.find((f) => f.key === key);
  return flag ? flag.isEnabled : fallback;
}