import { api } from "../../lib/api";

/**
 * Typed client for the discovery preferences API.
 *
 * Mirrors the backend contract exactly rather than loosening it. `lifestyle` is
 * a map of category to chosen values, which is what makes the page's save a single
 * request instead of one per question.
 */

export interface PreferenceOption {
  value: string;
  label: string;
}

export interface LifestyleCategory {
  category: string;
  label: string;
  options: PreferenceOption[];
}

export interface PreferenceCatalogue {
  interests: PreferenceOption[];
  languages: PreferenceOption[];
  lifestyle: LifestyleCategory[];
}

export interface Preferences {
  distanceKm: number;
  ageMin: number;
  ageMax: number;
  interests: string[];
  languages: string[];
  lifestyle: Record<string, string[]>;
}

export interface OptionsResponse {
  options: PreferenceCatalogue;
  distances: number[];
  anywhereKm: number;
  limits: { minAge: number; maxAge: number };
}

/** One field-level complaint from the server, addressed to a specific control. */
export interface PreferenceIssue {
  field: string;
  message: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
  extra?: { issues?: PreferenceIssue[] };
}

/**
 * Save the whole record.
 *
 * Rejects rather than partially applying. The backend validates against the
 * catalogue and returns 422 with a per-field issue list; the caller needs those
 * messages to put next to the control that caused the problem, so they are
 * extracted and attached to the thrown error rather than shown as a generic
 * "could not save".
 */
export class PreferenceValidationError extends Error {
  readonly issues: PreferenceIssue[];

  constructor(message: string, issues: PreferenceIssue[]) {
    super(message);
    this.name = "PreferenceValidationError";
    this.issues = issues;
  }
}

export async function fetchPreferences(): Promise<{ preferences: Preferences; hasLocation: boolean }> {
  const { data } = await api.get<ApiEnvelope<{ preferences: Preferences; hasLocation: boolean }>>(
    "/preferences",
  );
  return data.data;
}

export async function fetchPreferenceOptions(): Promise<OptionsResponse> {
  const { data } = await api.get<ApiEnvelope<OptionsResponse>>("/preferences/options");
  return data.data;
}

export async function savePreferences(preferences: Preferences): Promise<Preferences> {
  try {
    const { data } = await api.put<ApiEnvelope<{ preferences: Preferences }>>("/preferences", preferences);
    return data.data.preferences;
  } catch (err) {
    // axios rejects with the response attached; anything else is a genuine
    // network failure and is rethrown unchanged so the page can say so honestly.
    const response = (err as { response?: ApiEnvelope<unknown> }).response;
    if (response?.extra?.issues) {
      throw new PreferenceValidationError(response.message ?? "Check the highlighted fields.", response.extra.issues);
    }
    throw err;
  }
}

/**
 * Share a location, once, for distance sorting.
 *
 * Kept separate from savePreferences on purpose so that saving a preference can
 * never persist coordinates as a side effect. The page only calls this from the
 * explicit "use my location" button.
 */
export async function saveLocation(latitude: number, longitude: number): Promise<void> {
  await api.post("/preferences/location", { latitude, longitude });
}

export async function clearLocation(): Promise<void> {
  await api.delete("/preferences/location");
}