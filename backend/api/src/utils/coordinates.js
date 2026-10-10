/**
 * Validates a single coordinate component (latitude or longitude) against geographic bounds.
 *
 * @param {any} value - The coordinate value to validate
 * @param {'lat'|'latitude'|'lng'|'lon'|'longitude'} [type='lat'] - Coordinate axis
 * @param {string} [fieldName] - Field name to use in error messages
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
export function validateCoordinate(value, type = 'lat', fieldName = type) {
  if (value === null || value === undefined) {
    return { valid: false, error: `${fieldName} is required` };
  }
  if (typeof value === 'boolean' || Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  if (typeof value === 'string' && value.trim() === '') {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }

  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { valid: false, error: `${fieldName} must be a finite number` };
  }

  const isLat = type === 'lat' || type === 'latitude';
  const min = isLat ? -90 : -180;
  const max = isLat ? 90 : 180;

  if (num < min || num > max) {
    return { valid: false, error: `${fieldName} must be between ${min} and ${max}` };
  }

  return { valid: true, value: num };
}

/**
 * Returns an error message if the lat/lng pair is out of bounds or invalid, or null when valid.
 */
export function validateCoordinateRange(lat, lng, latName = 'lat', lngName = 'lng') {
  const latRes = validateCoordinate(lat, 'lat', latName);
  if (!latRes.valid) return latRes.error;
  const lngRes = validateCoordinate(lng, 'lng', lngName);
  if (!lngRes.valid) return lngRes.error;
  return null;
}

const EARTH_RADIUS_KM = 6371;

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
 * A longitude interval with minLng > maxLng crosses the antimeridian.
 *
 * @param {number} centerLat Center latitude
 * @param {number} centerLng Center longitude
 * @param {number} radiusKm Search radius in kilometers
 * @returns {{ minLat: number, maxLat: number, minLng: number, maxLng: number }}
 */
export function getBoundingBox(centerLat, centerLng, radiusKm) {
  const angle = Math.min(Math.PI, radiusKm / EARTH_RADIUS_KM);
  const latDelta = angle * 180 / Math.PI;
  const latRad = (centerLat * Math.PI) / 180;
  const minLat = Math.max(-90, centerLat - latDelta);
  const maxLat = Math.min(90, centerLat + latDelta);

  // A spherical cap touching either pole can contain every longitude.
  if (minLat <= -90 || maxLat >= 90) {
    return { minLat, maxLat, minLng: -180, maxLng: 180 };
  }
  const lngDelta = Math.asin(Math.min(1, Math.sin(angle) / Math.cos(latRad))) * 180 / Math.PI;
  const wrapLongitude = (lng) => ((lng + 540) % 360) - 180;

  return {
    minLat,
    maxLat,
    minLng: wrapLongitude(centerLng - lngDelta),
    maxLng: wrapLongitude(centerLng + lngDelta),
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

  // +180 and -180 describe the same meridian, including zero-radius boxes.
  const longitude = lng === 180 ? -180 : lng;
  const withinLongitude = box.minLng <= box.maxLng
    ? longitude >= box.minLng && longitude <= box.maxLng
    : longitude >= box.minLng || longitude <= box.maxLng;
  return (
    lat >= box.minLat &&
    lat <= box.maxLat &&
    withinLongitude
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
  validateCoordinate,
  validateCoordinateRange,
  haversineDistance,
  getBoundingBox,
  isWithinBoundingBox,
  filterCoordinatesByRadius,
};
