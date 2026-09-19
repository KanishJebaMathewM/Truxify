/**
 * Returns an error message if the lat/lng pair is out of bounds, or null when valid.
 */
export function validateCoordinateRange(lat, lng) {
  if (lat < -90 || lat > 90) return 'lat must be between -90 and 90';
  if (lng < -180 || lng > 180) return 'lng must be between -180 and 180';
  return null;
}

const EARTH_RADIUS_KM = 6371;
const KM_PER_LAT_DEGREE = 111.32;

/**
 * Calculates exact spherical distance between two geographic coordinates using Haversine formula.
 *
 * @param {number} lat1 Latitude of point 1
 * @param {number} lon1 Longitude of point 1
 * @param {number} lat2 Latitude of point 2
 * @param {number} lon2 Longitude of point 2
 * @param {'km'|'miles'} [unit='km'] Output distance unit
 * @returns {number} Distance in specified unit
 */
export function haversineDistance(lat1, lon1, lat2, lon2, unit = 'km') {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(rLat1) * Math.cos(rLat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = EARTH_RADIUS_KM * c;

  return unit === 'miles' ? distanceKm * 0.621371 : distanceKm;
}

/**
 * Computes a rectangular bounding box around a center coordinate for fast pre-filtering.
 *
 * @param {number} centerLat Center latitude
 * @param {number} centerLng Center longitude
 * @param {number} radiusKm Search radius in kilometers
 * @returns {{ minLat: number, maxLat: number, minLng: number, maxLng: number }}
 */
export function getBoundingBox(centerLat, centerLng, radiusKm) {
  const latDelta = radiusKm / KM_PER_LAT_DEGREE;
  const latRad = (centerLat * Math.PI) / 180;
  const lngDelta = radiusKm / (KM_PER_LAT_DEGREE * Math.max(0.0001, Math.cos(latRad)));

  return {
    minLat: Math.max(-90, centerLat - latDelta),
    maxLat: Math.min(90, centerLat + latDelta),
    minLng: Math.max(-180, centerLng - lngDelta),
    maxLng: Math.min(180, centerLng + lngDelta),
  };
}

/**
 * Fast scalar bounding-box check without trigonometric functions.
 *
 * @param {{ lat: number, lng: number }} point Candidate coordinate
 * @param {{ minLat: number, maxLat: number, minLng: number, maxLng: number }} box Bounding box
 * @returns {boolean} True if point lies inside the bounding box
 */
export function isWithinBoundingBox(point, box) {
  const lat = point.lat ?? point.latitude;
  const lng = point.lng ?? point.longitude;
  if (lat == null || lng == null) return false;

  return (
    lat >= box.minLat &&
    lat <= box.maxLat &&
    lng >= box.minLng &&
    lng <= box.maxLng
  );
}

/**
 * High-performance candidate filtering using Bounding-Box pre-filtering followed by exact Haversine calculation.
 * Pre-filters candidates using fast scalar comparisons to eliminate 80-90% of out-of-range points
 * before running expensive trigonometric calculations.
 *
 * @param {Array<{ lat: number, lng: number, [key: string]: any }>} candidates Candidate points
 * @param {{ lat: number, lng: number }} center Search center coordinate
 * @param {number} radiusKm Search radius in km
 * @param {Object} [opts] Options
 * @param {boolean} [opts.includeStats=false] If true, includes pre-filtering efficiency metrics
 * @returns {Array<Object> | { matches: Array<Object>, stats: Object }}
 */
export function filterCoordinatesByRadius(candidates, center, radiusKm, opts = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return opts.includeStats ? { matches: [], stats: { total: 0, passedBox: 0, matches: 0 } } : [];
  }

  const box = getBoundingBox(center.lat, center.lng, radiusKm);
  let passedBoxCount = 0;
  const matches = [];

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const itemLat = item.lat ?? item.latitude;
    const itemLng = item.lng ?? item.longitude;

    if (itemLat == null || itemLng == null) continue;

    // 1. Fast scalar bounding box pre-filter
    if (!isWithinBoundingBox({ lat: itemLat, lng: itemLng }, box)) {
      continue;
    }

    passedBoxCount++;

    // 2. Exact Haversine distance evaluation
    const distance = haversineDistance(center.lat, center.lng, itemLat, itemLng, 'km');
    if (distance <= radiusKm) {
      matches.push({
        ...item,
        distance: Math.round(distance * 1000) / 1000,
      });
    }
  }

  matches.sort((a, b) => a.distance - b.distance);

  if (opts.includeStats) {
    const eliminatedByBox = candidates.length - passedBoxCount;
    const efficiencyPercent = Math.round((eliminatedByBox / candidates.length) * 100);
    return {
      matches,
      stats: {
        total: candidates.length,
        passedBox: passedBoxCount,
        matches: matches.length,
        eliminatedByBox,
        efficiencyPercent,
      },
    };
  }

  return matches;
}

export default {
  validateCoordinateRange,
  haversineDistance,
  getBoundingBox,
  isWithinBoundingBox,
  filterCoordinatesByRadius,
};
