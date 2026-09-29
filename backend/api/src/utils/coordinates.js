/**
 * Returns an error message if the lat/lng pair is out of bounds, or null when valid.
 */
export function validateCoordinateRange(lat, lng) {
  if (lat < -90 || lat > 90) return 'lat must be between -90 and 90';
  if (lng < -180 || lng > 180) return 'lng must be between -180 and 180';
  return null;
}

export const EARTH_RADIUS_KM = 6371.0088;

/**
 * Calculates the great-circle distance between two points on Earth using the Haversine formula.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @param {'km'|'meters'} unit 
 * @returns {number} Distance in the specified unit
 */
export function haversineDistance(lat1, lon1, lat2, lon2, unit = 'km') {
  if (
    !Number.isFinite(lat1) || !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) || !Number.isFinite(lon2)
  ) {
    throw new TypeError('haversineDistance requires finite numeric lat/lng arguments');
  }
  if (lat1 === lat2 && lon1 === lon2) return 0;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const r = unit === 'meters' || unit === 'm' ? EARTH_RADIUS_KM * 1000 : EARTH_RADIUS_KM;
  return r * c;
}
