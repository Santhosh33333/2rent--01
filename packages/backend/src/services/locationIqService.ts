import { env } from "../config/env";

const BASE_URL = env.LOCATIONIQ_BASE_URL;
const API_KEY = env.LOCATIONIQ_API_KEY;

interface LocationIQOptions {
  timeout?: number;
  retries?: number;
}

interface GeocodingResult {
  placeId: string;
  licence: string;
  osmType: string;
  osmId: string;
  lat: number;
  lon: number;
  displayName: string;
  address: {
    houseNumber?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countryCode?: string;
  };
  boundingbox: number[];
  type: string;
  importance: number;
}

interface ReverseResult {
  placeId: string;
  licence: string;
  osmType: string;
  osmId: string;
  lat: number;
  lon: number;
  displayName: string;
  address: {
    houseNumber?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countryCode?: string;
  };
}

interface AutocompleteResult {
  placeId: string;
  osmId: string;
  osmType: string;
  lat: number;
  lon: number;
  displayName: string;
  type: string;
  importance: number;
}

interface NearbyResult {
  placeId: string;
  osmId: string;
  osmType: string;
  lat: number;
  lon: number;
  displayName: string;
  type: string;
  distance: number;
  importance: number;
}

interface RouteResult {
  code: string;
  routes: Array<{
    distance: number;
    duration: number;
    geometry: string;
    legs: Array<{
      distance: number;
      duration: number;
      steps: Array<{
        distance: number;
        duration: number;
        instruction: string;
        name: string;
        maneuver: {
          bearing_before: number;
          bearing_after: number;
          location: number[];
        };
      }>;
    }>;
  }>;
}

async function fetchWithRetry(
  url: string,
  options: LocationIQOptions = {}
): Promise<any> {
  const { timeout = 10000, retries = 2 } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
        },
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`LocationIQ API error ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (err: any) {
      lastError = err;
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error("LocationIQ API failed after retries:", lastError?.message);
  throw lastError || new Error("LocationIQ API request failed");
}

function validateCoordinates(lat: number, lon: number): void {
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error("Invalid coordinates: latitude must be -90 to 90, longitude must be -180 to 180");
  }
}

export async function forwardGeocode(
  address: string,
  options?: { countryCodes?: string; limit?: number }
): Promise<GeocodingResult[]> {
  if (!address || address.trim().length < 2) {
    throw new Error("Address must be at least 2 characters");
  }

  const params = new URLSearchParams({
    key: API_KEY,
    q: address.trim(),
    format: "json",
    addressdetails: "1",
    limit: String(options?.limit || 5),
    normalizecity: "1",
  });

  if (options?.countryCodes) {
    params.set("countrycodes", options.countryCodes);
  }

  const url = `${BASE_URL}/search.php?${params.toString()}`;
  const results = await fetchWithRetry(url);

  return results.map((r: any) => ({
    placeId: r.place_id,
    licence: r.licence,
    osmType: r.osm_type,
    osmId: r.osm_id,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    displayName: r.display_name,
    address: {
      houseNumber: r.address?.house_number,
      road: r.address?.road,
      neighbourhood: r.address?.neighbourhood,
      suburb: r.address?.suburb,
      city: r.address?.city || r.address?.town || r.address?.village,
      county: r.address?.county,
      state: r.address?.state,
      postcode: r.address?.postcode,
      country: r.address?.country,
      countryCode: r.address?.country_code,
    },
    boundingbox: r.boundingbox?.map(Number) || [],
    type: r.type,
    importance: r.importance,
  }));
}

export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<ReverseResult> {
  validateCoordinates(lat, lon);

  const params = new URLSearchParams({
    key: API_KEY,
    lat: String(lat),
    lon: String(lon),
    format: "json",
    addressdetails: "1",
    normalizecity: "1",
  });

  const url = `${BASE_URL}/reverse.php?${params.toString()}`;
  const r = await fetchWithRetry(url);

  return {
    placeId: r.place_id,
    licence: r.licence,
    osmType: r.osm_type,
    osmId: r.osm_id,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    displayName: r.display_name,
    address: {
      houseNumber: r.address?.house_number,
      road: r.address?.road,
      neighbourhood: r.address?.neighbourhood,
      suburb: r.address?.suburb,
      city: r.address?.city || r.address?.town || r.address?.village,
      county: r.address?.county,
      state: r.address?.state,
      postcode: r.address?.postcode,
      country: r.address?.country,
      countryCode: r.address?.country_code,
    },
  };
}

export async function autocomplete(
  query: string,
  options?: { countryCodes?: string; lat?: number; lon?: number; limit?: number }
): Promise<AutocompleteResult[]> {
  if (!query || query.trim().length < 2) {
    throw new Error("Query must be at least 2 characters");
  }

  const params = new URLSearchParams({
    key: API_KEY,
    q: query.trim(),
    format: "json",
    limit: String(options?.limit || 5),
    normalizecity: "1",
  });

  if (options?.countryCodes) {
    params.set("countrycodes", options.countryCodes);
  }
  if (options?.lat !== undefined && options?.lon !== undefined) {
    params.set("viewbox", `${options.lon - 0.1},${options.lat + 0.1},${options.lon + 0.1},${options.lat - 0.1}`);
    params.set("bounded", "0");
  }

  const url = `${BASE_URL}/autocomplete.php?${params.toString()}`;
  const results = await fetchWithRetry(url);

  return results.map((r: any) => ({
    placeId: r.place_id,
    osmId: r.osm_id,
    osmType: r.osm_type,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    displayName: r.display_name,
    type: r.type,
    importance: r.importance,
  }));
}

export async function nearbySearch(
  lat: number,
  lon: number,
  options?: { tag?: string; radius?: number; limit?: number }
): Promise<NearbyResult[]> {
  validateCoordinates(lat, lon);

  const params = new URLSearchParams({
    key: API_KEY,
    lat: String(lat),
    lon: String(lon),
    format: "json",
    limit: String(options?.limit || 20),
  });

  if (options?.tag) {
    params.set("tag", options.tag);
  }
  if (options?.radius) {
    params.set("radius", String(options.radius));
  }

  const url = `${BASE_URL}/nearby.php?${params.toString()}`;
  const results = await fetchWithRetry(url);

  return results.map((r: any) => ({
    placeId: r.place_id,
    osmId: r.osm_id,
    osmType: r.osm_type,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    displayName: r.display_name,
    type: r.type,
    distance: r.distance,
    importance: r.importance,
  }));
}

export async function calculateRoute(
  coordinates: Array<{ lat: number; lon: number }>,
  options?: { alternative?: boolean; steps?: boolean }
): Promise<RouteResult> {
  if (coordinates.length < 2) {
    throw new Error("At least 2 coordinates required for routing");
  }

  coordinates.forEach((c) => validateCoordinates(c.lat, c.lon));

  const coords = coordinates.map((c) => `${c.lon},${c.lat}`).join(";");

  const params = new URLSearchParams({
    key: API_KEY,
    coordinates: coords,
    overview: "full",
    geometries: "polyline",
    steps: options?.steps !== false ? "true" : "false",
  });

  if (options?.alternative) {
    params.set("alternatives", "true");
  }

  const url = `${BASE_URL}/directions/driving?${params.toString()}`;
  const result = await fetchWithRetry(url);

  return {
    code: result.code,
    routes: result.routes.map((route: any) => ({
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry,
      legs: route.legs.map((leg: any) => ({
        distance: leg.distance,
        duration: leg.duration,
        steps: leg.steps?.map((step: any) => ({
          distance: step.distance,
          duration: step.duration,
          instruction: step.maneuver?.type || "",
          name: step.name || "",
          maneuver: {
            bearing_before: step.maneuver?.bearing_before || 0,
            bearing_after: step.maneuver?.bearing_after || 0,
            location: step.maneuver?.location || [0, 0],
          },
        })) || [],
      })),
    })),
  };
}

export async function calculateDistance(
  coordinates: Array<{ lat: number; lon: number }>
): Promise<{ distance: number; duration: number }> {
  const route = await calculateRoute(coordinates, { steps: false });
  if (route.routes.length === 0) {
    throw new Error("No route found");
  }
  return {
    distance: route.routes[0].distance,
    duration: route.routes[0].duration,
  };
}

export async function calculateETA(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<{ distance: number; duration: number; eta: string }> {
  const result = await calculateDistance([from, to]);
  const etaMinutes = Math.ceil(result.duration / 60);
  const hours = Math.floor(etaMinutes / 60);
  const minutes = etaMinutes % 60;

  return {
    distance: result.distance,
    duration: result.duration,
    eta: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
  };
}

export function calculateStraightLineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function isWithinServiceArea(
  lat: number,
  lon: number,
  serviceAreas: Array<{ centerLat: number; centerLon: number; radiusKm: number }>
): boolean {
  return serviceAreas.some((area) => {
    const distance = calculateStraightLineDistance(lat, lon, area.centerLat, area.centerLon);
    return distance <= area.radiusKm;
  });
}

export async function validateAddress(
  address: string
): Promise<{ valid: boolean; formattedAddress?: string; coordinates?: { lat: number; lon: number } }> {
  try {
    const results = await forwardGeocode(address, { limit: 1 });
    if (results.length === 0) {
      return { valid: false };
    }
    return {
      valid: true,
      formattedAddress: results[0].displayName,
      coordinates: { lat: results[0].lat, lon: results[0].lon },
    };
  } catch {
    return { valid: false };
  }
}
