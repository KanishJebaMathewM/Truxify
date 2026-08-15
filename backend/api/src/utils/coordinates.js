/**
 * Returns an error message if the lat/lng pair is out of bounds, or null when valid.
 */
export function validateCoordinateRange(lat, lng) {
  if (lat < -90 || lat > 90) return 'lat must be between -90 and 90';
  if (lng < -180 || lng > 180) return 'lng must be between -180 and 180';
  return null;
}
