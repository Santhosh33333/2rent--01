/**
 * Calculate haversine distance between two coordinates
 * @param lat1 Starting latitude
 * @param lon1 Starting longitude
 * @param lat2 Ending latitude
 * @param lon2 Ending longitude
 * @returns Distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Convert degrees to radians
 */
function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Check if two coordinates are within a certain radius
 * @param lat1 Point 1 latitude
 * @param lon1 Point 1 longitude
 * @param lat2 Point 2 latitude
 * @param lon2 Point 2 longitude
 * @param radiusKm Radius in kilometers
 */
export function isWithinRadius(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  radiusKm: number
): boolean {
  const distance = calculateDistance(lat1, lon1, lat2, lon2);
  return distance <= radiusKm;
}

/**
 * Get bounding box for a center point and radius (useful for queries)
 */
export function getBoundingBox(
  centerLat: number,
  centerLon: number,
  radiusKm: number
): {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
} {
  const latDelta = radiusKm / 111; // 1 degree latitude ≈ 111 km
  const lonDelta = radiusKm / (111 * Math.cos((centerLat * Math.PI) / 180));

  return {
    minLat: centerLat - latDelta,
    maxLat: centerLat + latDelta,
    minLon: centerLon - lonDelta,
    maxLon: centerLon + lonDelta,
  };
}
