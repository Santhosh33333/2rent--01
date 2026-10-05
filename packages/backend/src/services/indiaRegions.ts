/**
 * Which Indian state a coordinate falls in, and which languages that audience
 * actually wants.
 *
 * WHY A LOCAL TABLE RATHER THAN A GEOCODER
 * ---------------------------------------
 * Resolving lat/lng to a state looks like it wants a geocoding API, but the
 * only ones that do Indian state-level resolution are paid (Google, Mapbox,
 * LocationIQ) and would put a network round-trip and an API key between the
 * user and their film list. The answer needed here is coarse - "is this person
 * in Tamil Nadu" - and Indian states are large enough that nearest-centroid
 * classification against state centres is accurate for the purpose. It also
 * works offline and costs nothing.
 *
 * The centroid table is state *centres*, not bounding boxes, because bounding
 * boxes overlap heavily across the north-east and misclassify border districts.
 * Nearest-centroid gets those right without needing district polygons.
 *
 * Cities are listed separately because a city centre is a far better anchor
 * than a state centroid for the dense states: someone in Chennai is 150km from
 * the Tamil Nadu centroid, and without a Chennai anchor that pulls them toward
 * a neighbouring state's language.
 */

export interface IndianRegion {
  code: string;
  name: string;
  /** ISO 639-1 codes, most-preferred first. */
  languages: string[];
  lat: number;
  lng: number;
}

/** State-level anchors. */
const STATE_ANCHORS: IndianRegion[] = [
  { code: "TN", name: "Tamil Nadu", languages: ["ta", "en"], lat: 11.1271, lng: 78.6569 },
  { code: "KL", name: "Kerala", languages: ["ml", "en"], lat: 10.8505, lng: 76.2711 },
  { code: "KA", name: "Karnataka", languages: ["kn", "ta", "en"], lat: 15.3173, lng: 75.7139 },
  { code: "AP", name: "Andhra Pradesh", languages: ["te", "en"], lat: 15.9129, lng: 79.7400 },
  { code: "TS", name: "Telangana", languages: ["te", "en"], lat: 17.1232, lng: 79.2088 },
  { code: "MH", name: "Maharashtra", languages: ["mr", "en"], lat: 19.7515, lng: 75.7139 },
  { code: "GJ", name: "Gujarat", languages: ["gu", "hi", "en"], lat: 22.2587, lng: 71.1924 },
  { code: "RJ", name: "Rajasthan", languages: ["hi", "en"], lat: 27.0238, lng: 74.2179 },
  { code: "MP", name: "Madhya Pradesh", languages: ["hi", "en"], lat: 22.9734, lng: 78.6569 },
  { code: "UP", name: "Uttar Pradesh", languages: ["hi", "en"], lat: 26.8467, lng: 80.9462 },
  { code: "BR", name: "Bihar", languages: ["hi", "bho", "en"], lat: 25.0961, lng: 85.3131 },
  { code: "JH", name: "Jharkhand", languages: ["hi", "en"], lat: 23.6102, lng: 85.2799 },
  { code: "OD", name: "Odisha", languages: ["or", "hi", "en"], lat: 20.9517, lng: 85.0985 },
  { code: "WB", name: "West Bengal", languages: ["bn", "hi", "en"], lat: 22.9868, lng: 87.8550 },
  { code: "AS", name: "Assam", languages: ["as", "en"], lat: 26.2006, lng: 92.9376 },
  { code: "HR", name: "Haryana", languages: ["hi", "en"], lat: 29.0588, lng: 76.0856 },
  { code: "PB", name: "Punjab", languages: ["pa", "hi", "en"], lat: 31.1471, lng: 75.3412 },
  { code: "CH", name: "Chandigarh", languages: ["pa", "hi", "en"], lat: 30.7333, lng: 76.7794 },
  { code: "DL", name: "Delhi", languages: ["hi", "en"], lat: 28.6139, lng: 77.2090 },
  { code: "JK", name: "Jammu & Kashmir", languages: ["ur", "kas", "hi", "en"], lat: 33.7782, lng: 76.5762 },
  { code: "HP", name: "Himachal Pradesh", languages: ["hi", "en"], lat: 31.1048, lng: 77.1734 },
  { code: "UK", name: "Uttarakhand", languages: ["hi", "en"], lat: 30.0668, lng: 79.0193 },
  { code: "GA", name: "Goa", languages: ["kon", "mr", "en"], lat: 15.2993, lng: 74.1240 },
  { code: "PY", name: "Puducherry", languages: ["ta", "en"], lat: 11.9416, lng: 79.8083 },
  // Union territories and the north-east, which bounding boxes get wrong most.
  { code: "MN", name: "Manipur", languages: ["mni", "en"], lat: 24.6637, lng: 93.9063 },
  { code: "ML", name: "Meghalaya", languages: ["en"], lat: 25.4670, lng: 91.3662 },
  { code: "MZ", name: "Mizoram", languages: ["mni", "en"], lat: 23.1645, lng: 92.9376 },
  { code: "NL", name: "Nagaland", languages: ["en"], lat: 26.1584, lng: 94.5624 },
  { code: "TR", name: "Tripura", languages: ["bn", "en"], lat: 23.9408, lng: 91.9882 },
  { code: "AR", name: "Arunachal Pradesh", languages: ["en"], lat: 28.2180, lng: 94.7278 },
  { code: "MN2", name: "Andaman & Nicobar", languages: ["hi", "en"], lat: 11.7401, lng: 92.6586 },
  { code: "LD", name: "Lakshadweep", languages: ["ml", "en"], lat: 10.5667, lng: 72.6417 },
  { code: "DN", name: "Dadra & Nagar Haveli and Daman & Diu", languages: ["gu", "hi", "en"], lat: 20.3974, lng: 72.8328 },
];

/**
 * City anchors. A dense state's centroid can be a long way from where people
 * actually are, so major film centres get their own anchor. Nearest-centroid
 * checks cities first and falls back to states.
 */
const CITY_ANCHORS: Array<IndianRegion & { city: string }> = [
  { code: "TN", city: "Chennai", name: "Chennai, Tamil Nadu", languages: ["ta", "en"], lat: 13.0827, lng: 80.2707 },
  { code: "TN", city: "Coimbatore", name: "Coimbatore, Tamil Nadu", languages: ["ta", "en"], lat: 11.0168, lng: 76.9558 },
  { code: "TN", city: "Madurai", name: "Madurai, Tamil Nadu", languages: ["ta", "en"], lat: 9.9252, lng: 78.1198 },
  { code: "TN", city: "Tiruchirappalli", name: "Tiruchirappalli, Tamil Nadu", languages: ["ta", "en"], lat: 10.7905, lng: 78.7047 },
  { code: "TN", city: "Salem", name: "Salem, Tamil Nadu", languages: ["ta", "en"], lat: 11.6643, lng: 78.1460 },
  { code: "TN", city: "Tirunelveli", name: "Tirunelveli, Tamil Nadu", languages: ["ta", "en"], lat: 8.7139, lng: 77.7567 },
  { code: "KL", city: "Kochi", name: "Kochi, Kerala", languages: ["ml", "en"], lat: 9.9312, lng: 76.2673 },
  { code: "KL", city: "Thiruvananthapuram", name: "Thiruvananthapuram, Kerala", languages: ["ml", "en"], lat: 8.5241, lng: 76.9366 },
  { code: "KL", city: "Kozhikode", name: "Kozhikode, Kerala", languages: ["ml", "en"], lat: 11.2588, lng: 75.7804 },
  { code: "KA", city: "Bengaluru", name: "Bengaluru, Karnataka", languages: ["kn", "ta", "en"], lat: 12.9716, lng: 77.5946 },
  { code: "KA", city: "Mysuru", name: "Mysuru, Karnataka", languages: ["kn", "en"], lat: 12.2958, lng: 76.6394 },
  { code: "KA", city: "Hubballi", name: "Hubballi, Karnataka", languages: ["kn", "en"], lat: 15.3647, lng: 75.1240 },
  { code: "MH", city: "Mumbai", name: "Mumbai, Maharashtra", languages: ["mr", "hi", "en"], lat: 19.0760, lng: 72.8777 },
  { code: "MH", city: "Pune", name: "Pune, Maharashtra", languages: ["mr", "hi", "en"], lat: 18.5204, lng: 73.8567 },
  { code: "MH", city: "Nagpur", name: "Nagpur, Maharashtra", languages: ["mr", "hi", "en"], lat: 21.1458, lng: 79.0882 },
  { code: "DL", city: "Delhi", name: "Delhi", languages: ["hi", "en"], lat: 28.6139, lng: 77.2090 },
  { code: "TS", city: "Hyderabad", name: "Hyderabad, Telangana", languages: ["te", "en"], lat: 17.3850, lng: 78.4867 },
  { code: "AP", city: "Visakhapatnam", name: "Visakhapatnam, Andhra Pradesh", languages: ["te", "en"], lat: 17.6868, lng: 83.2185 },
  { code: "WB", city: "Kolkata", name: "Kolkata, West Bengal", languages: ["bn", "hi", "en"], lat: 22.5726, lng: 88.3639 },
  { code: "PB", city: "Ludhiana", name: "Ludhiana, Punjab", languages: ["pa", "hi", "en"], lat: 30.9010, lng: 75.8573 },
  { code: "GJ", city: "Ahmedabad", name: "Ahmedabad, Gujarat", languages: ["gu", "hi", "en"], lat: 23.0225, lng: 72.5714 },
  { code: "GJ", city: "Surat", name: "Surat, Gujarat", languages: ["gu", "hi", "en"], lat: 21.1702, lng: 72.8311 },
  { code: "RJ", city: "Jaipur", name: "Jaipur, Rajasthan", languages: ["hi", "en"], lat: 26.9124, lng: 75.7873 },
  { code: "UP", city: "Lucknow", name: "Lucknow, Uttar Pradesh", languages: ["hi", "en"], lat: 26.8467, lng: 80.9462 },
  { code: "UP", city: "Varanasi", name: "Varanasi, Uttar Pradesh", languages: ["hi", "en"], lat: 25.3176, lng: 82.9739 },
  { code: "MP", city: "Indore", name: "Indore, Madhya Pradesh", languages: ["hi", "en"], lat: 22.7196, lng: 75.8577 },
  { code: "MP", city: "Bhopal", name: "Bhopal, Madhya Pradesh", languages: ["hi", "en"], lat: 23.2599, lng: 77.4126 },
  { code: "OD", city: "Bhubaneswar", name: "Bhubaneswar, Odisha", languages: ["or", "hi", "en"], lat: 20.2961, lng: 85.8245 },
  { code: "AS", city: "Guwahati", name: "Guwahati, Assam", languages: ["as", "en"], lat: 26.1445, lng: 91.7362 },
];

/** Great-circle distance in km. Haversine; accurate enough at this scale. */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * A hard ceiling on how far a coordinate may be from the anchor it matches.
 *
 * Nearest-centroid alone will happily "resolve" a point in the middle of the
 * Arabian Sea or Nepal to Goa or Uttar Pradesh, and then serve a confidently
 * wrong regional catalogue. Anything beyond this radius is reported as
 * out-of-range so the caller can fall back to the national list instead of
 * inventing a location.
 */
const MAX_MATCH_KM = 320;

export interface ResolvedLocation {
  /** True when the coordinate fell inside the coverage area. */
  inRange: boolean;
  code: string;
  label: string;
  languages: string[];
  /** Distance to the matched anchor, for the "near you" copy. */
  distanceKm: number | null;
  /** Set when nothing matched, so the caller can log it rather than guess. */
  reason?: string;
}

/**
 * Resolves a coordinate to an Indian region and its preferred languages.
 *
 * Any finite coordinate is accepted; an implausible one is reported as
 * out-of-range rather than silently mapped to a state it is nowhere near.
 */
export function resolveIndianRegion(lat?: number | null, lng?: number | null): ResolvedLocation {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return { inRange: false, code: "", label: "All India", languages: [], distanceKm: null };
  }

  // Anything outside the subcontinent is not "some other Indian state", it is
  // simply not covered. Saying Tamil Nadu to someone in Dubai is worse than
  // saying the national list.
  if (lat < 6 || lat > 38 || lng < 68 || lng > 98) {
    return {
      inRange: false,
      code: "",
      label: "All India",
      languages: [],
      distanceKm: null,
      reason: "outside_india",
    };
  }

  let best: { r: IndianRegion; km: number; label: string } | null = null;

  for (const city of CITY_ANCHORS) {
    const km = distanceKm(lat, lng, city.lat, city.lng);
    if (!best || km < best.km) {
      best = { r: city, km, label: city.name };
    }
  }
  for (const state of STATE_ANCHORS) {
    const km = distanceKm(lat, lng, state.lat, state.lng);
    if (!best || km < best.km) {
      best = { r: state, km, label: state.name };
    }
  }

  if (!best || best.km > MAX_MATCH_KM) {
    return {
      inRange: false,
      code: "",
      label: "All India",
      languages: [],
      distanceKm: best ? Math.round(best.km) : null,
      reason: "no_anchor_in_range",
    };
  }

  return {
    inRange: true,
    code: best.r.code,
    label: best.label,
    languages: best.r.languages,
    distanceKm: Math.round(best.km),
  };
}

/** States with a regional-language catalogue, for the settings picker. */
export function listIndianRegions(): Array<{ code: string; name: string; languages: string[] }> {
  const seen = new Map<string, { code: string; name: string; languages: string[] }>();
  for (const s of STATE_ANCHORS) {
    if (!seen.has(s.code)) seen.set(s.code, { code: s.code, name: s.name, languages: s.languages });
  }
  return [...seen.values()];
}
