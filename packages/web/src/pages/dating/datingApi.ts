import { api } from "../../lib/api";

export type SwipeType = "LIKE" | "PASS" | "SUPER_LIKE";

export interface DiscoverProfile {
  id: string;
  fullName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  language?: string | null;
  mobileVerified?: boolean;
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

export interface DiscoverFilters {
  minAge?: number;
  maxAge?: number;
  city?: string;
  gender?: string;
}

export async function fetchDiscover(filters: DiscoverFilters, signal?: AbortSignal) {
  const { data } = await api.get<{ data: { results: DiscoverProfile[] } }>(
    "/dating/discover",
    { params: filters, signal },
  );
  return data.data.results;
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