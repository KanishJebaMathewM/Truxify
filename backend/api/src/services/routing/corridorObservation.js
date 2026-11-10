import { EARTH_RADIUS_METERS } from '../gps/geofenceEvaluator.js';
export const MAX_ROUTE_POINTS = 20000;
export const MAX_ROUTE_RESPONSE_BYTES = 1024 * 1024;

export function geographic(point) {
  if (!point || typeof point !== 'object' || Array.isArray(point)) throw new TypeError('coordinate must be an object');
  const { lat, lng } = point;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)
      || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new RangeError('coordinate must be finite and geographic');
  return Object.freeze({ lat, lng });
}
export function bufferRadius(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Math.PI * EARTH_RADIUS_METERS) {
    throw new RangeError('buffer must be between zero and the spherical antipodal distance');
  }
  return value;
}
export function ownCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > MAX_ROUTE_POINTS) {
    throw new TypeError('route must have between 2 and 20000 complete coordinates');
  }
  return Array.from(coordinates, (point, index) => {
    if (index >= MAX_ROUTE_POINTS || !Array.isArray(point) || point.length !== 2) throw new TypeError('route coordinate must be a complete longitude/latitude pair');
    const admitted = geographic({ lng: point[0], lat: point[1] });
    return [admitted.lng, admitted.lat];
  });
}
export function admitRoute(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('OSRM Route must be an object');
  if (data.code === 'NoRoute') return null;
  const route = data.routes?.[0];
  if (data.code !== 'Ok' || !Array.isArray(data.routes)
      || !route || typeof route !== 'object' || Array.isArray(route) || Array.isArray(route.geometry) || route.geometry?.type !== 'LineString') {
    throw new TypeError('OSRM Route must have an Ok complete GeoJSON LineString');
  }
  const coordinates = ownCoordinates(route.geometry.coordinates);
  for (const key of ['distance', 'duration']) {
    if (typeof route[key] !== 'number' || !Number.isFinite(route[key]) || route[key] < 0 || route[key] > 1e12) {
      throw new RangeError(`route ${key} must be finite, nonnegative and bounded`);
    }
  }
  return { coordinates, distanceKm: Number((route.distance / 1000).toFixed(2)),
    durationMinutes: Number((route.duration / 60).toFixed(1)), source: 'osrm', routeObserved: true, reason: 'observed_route' };
}

/** Conservative spherical envelope of the vertex bounds, not an exact road/PostGIS polygon. */
export function corridorEnvelope(coordinates, radius) {
  const points = ownCoordinates(coordinates);
  bufferRadius(radius);
  const latitudes = points.map(point => point[1]); const longitudes = points.map(point => point[0]);
  let minLat = Infinity; let maxLat = -Infinity; let minLng = Infinity; let maxLng = -Infinity;
  for (const value of latitudes) { minLat = Math.min(minLat, value); maxLat = Math.max(maxLat, value); }
  for (const value of longitudes) { minLng = Math.min(minLng, value); maxLng = Math.max(maxLng, value); }
  const angle = radius / EARTH_RADIUS_METERS;
  const degrees = angle * 180 / Math.PI;
  const lowLat = Math.max(-90, minLat - degrees); const highLat = Math.min(90, maxLat + degrees);
  const polar = minLat - degrees <= -90 || maxLat + degrees >= 90;
  let global = polar || maxLng - minLng > 180;
  let lowLng = -180; let highLng = 180;
  if (!global) {
    const latitude = Math.max(Math.abs(minLat), Math.abs(maxLat)) * Math.PI / 180;
    const longitudeDegrees = Math.asin(Math.min(1, Math.sin(angle) / Math.cos(latitude))) * 180 / Math.PI;
    lowLng = minLng - longitudeDegrees; highLng = maxLng + longitudeDegrees;
    if (lowLng < -180 || highLng > 180) global = true;
  }
  // Outward rounding preserves the admitted envelope rather than dropping boundary points.
  const down = value => Math.floor(value * 1e6) / 1e6;
  const up = value => Math.ceil(value * 1e6) / 1e6;
  return { boundingBox: { minLng: global ? -180 : Math.max(-180, down(lowLng)), maxLng: global ? 180 : Math.min(180, up(highLng)),
    minLat: Math.max(-90, down(lowLat)), maxLat: Math.min(90, up(highLat)) }, longitudeMode: global ? 'global' : 'local' };
}
