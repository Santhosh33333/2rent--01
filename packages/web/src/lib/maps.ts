/**
 * Map / directions links for event locations.
 *
 * Event.location is free text ("Koramangala 5th Block") and Event.latitude /
 * Event.longitude are nullable: plenty of events are online-only or listed
 * without a pin. The public event endpoint deliberately omits the coordinates
 * (exact venue coordinates on a public listing is a privacy cost with no
 * product benefit), so the reliable signal almost everywhere is the text.
 *
 * Google Maps' documented "search and show a place" URL is used rather than a
 * hardcoded embed: it opens the native Maps app on Android/iOS and the web map
 * on desktop, and it works off the venue text without us geocoding.
 */

const GOOGLE_MAPS_SEARCH = 'https://www.google.com/maps/search/?api=1&query='

/** Placeholders and empties we must never turn into a directions link. */
const UNUSABLE = new Set(['', 'tba', 'tbd', 'online', 'n/a', 'na', 'none', '-'])

export function isUsableLocation(location?: string | null): boolean {
  const value = (location ?? '').trim()
  if (!value) return false
  if (UNUSABLE.has(value.toLowerCase())) return false
  // "TBA", "TBC - to be confirmed", "Venue TBA" all mean the venue is not
  // announced yet. Searching Google Maps for those words returns a confident
  // pin in the wrong city, which is worse than offering no link at all.
  if (/\b(tba|tbc)\b/i.test(value)) return false
  return true
}

/**
 * Returns a Maps URL for the venue, or null when there is nothing to point at.
 *
 * When coordinates are known they win: a pin beats a text match, because
 * "Koramangala" alone can land on the wrong building. Anonymous visitors never
 * have coordinates, so the text path is the common case and has to be good
 * enough on its own.
 */
export function directionsUrl(
  location?: string | null,
  coordinates?: { latitude?: number | null; longitude?: number | null } | null
): string | null {
  const lat = coordinates?.latitude
  const lng = coordinates?.longitude
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${GOOGLE_MAPS_SEARCH}${encodeURIComponent(`${lat},${lng}`)}`
  }
  if (!isUsableLocation(location)) return null
  return `${GOOGLE_MAPS_SEARCH}${encodeURIComponent((location ?? '').trim())}`
}
