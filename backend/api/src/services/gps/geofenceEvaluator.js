import logger from '../../middleware/logger.js';

export const EARTH_RADIUS_METERS = 6371008.8;
const MAX_RADIUS_METERS = Math.PI * EARTH_RADIUS_METERS;

function coordinate(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number'
      || !Number.isFinite(lat) || !Number.isFinite(lng)
      || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new RangeError('coordinates must be finite geographic latitude/longitude');
  }
}

function identifier(value, label) {
  if (typeof value === 'string' && value.length <= 256 && value.trim() && value === value.trim()) return value;
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${label} must be a bounded nonblank string or nonnegative integer`);
}

function text(value, fallback, label, limit) {
  const result = value ?? fallback;
  if (typeof result !== 'string' || !result.trim() || result.length > limit) {
    throw new TypeError(`${label} must be a bounded nonblank string`);
  }
  return result;
}

function capacity(value, fallback, label) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 1e6) {
    throw new RangeError(`${label} must be a positive integer at most 1000000`);
  }
  return result;
}

/** Geographic spherical distance; clamp the Haversine roundoff domain at antipodes. */
export function calculateHaversineDistanceMeters(lat1, lng1, lat2, lng2) {
  coordinate(lat1, lng1);
  coordinate(lat2, lng2);
  if (lat1 === lat2 && (lng1 === lng2 || Math.abs(lng1 - lng2) === 360 || Math.abs(lat1) === 90)) return 0;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const admitted = Math.max(0, Math.min(1, a));
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(admitted), Math.sqrt(1 - admitted));
}

export class GeofenceEvaluator {
  #geofences = new Map();
  #tripStates = new Map();
  #maxGeofences;
  #maxTrips;

  constructor(options = {}) {
    this.#maxGeofences = capacity(options.maxGeofences, 1024, 'maxGeofences');
    this.#maxTrips = capacity(options.maxTrips, 10000, 'maxTrips');
  }

  // Readable views retain the legacy shape without exposing owned maps/sets.
  get geofences() { return new Map(Array.from(this.#geofences, ([id, fence]) => [id, { ...fence }])); }
  get tripStates() { return new Map(Array.from(this.#tripStates, ([trip, ids]) => [trip, new Set(ids)])); }

  registerGeofence(geofence) {
    if (!geofence || typeof geofence !== 'object' || Array.isArray(geofence)) {
      throw new TypeError('geofence must be a complete object');
    }
    const { id, lat, lng, radiusMeters, name, type } = geofence;
    identifier(id, 'geofence id');
    coordinate(lat, lng);
    const radius = radiusMeters ?? 500;
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > MAX_RADIUS_METERS) {
      throw new RangeError('radius must be between zero and the spherical antipodal distance');
    }
    const fence = Object.freeze({ id, lat, lng, radiusMeters: radius,
      name: text(name, 'Geofence Perimeter', 'name', 512), type: text(type, 'WAYPOINT', 'type', 64) });
    if (!this.#geofences.has(id) && this.#geofences.size >= this.#maxGeofences) {
      throw new RangeError('geofence capacity reached; remove an unused fence first');
    }
    this.#geofences.set(id, fence);
  }

  /** Prepare all events and membership before publishing one complete observation. */
  evaluateLocation(tripId, lat, lng) {
    identifier(tripId, 'trip id');
    coordinate(lat, lng);
    if (!this.#tripStates.has(tripId) && this.#tripStates.size >= this.#maxTrips) {
      throw new RangeError('trip capacity reached; clear a completed trip first');
    }
    const previous = this.#tripStates.get(tripId) ?? new Set();
    const next = new Set();
    const events = [];
    const timestamp = new Date().toISOString();
    for (const [id, fence] of this.#geofences) {
      const distance = calculateHaversineDistanceMeters(lat, lng, fence.lat, fence.lng);
      const inside = distance <= fence.radiusMeters;
      if (inside) next.add(id);
      if (inside !== previous.has(id)) {
        events.push({ eventType: inside ? 'GEOFENCE_ENTER' : 'GEOFENCE_EXIT', tripId,
          geofenceId: id, geofenceName: fence.name, geofenceType: fence.type,
          distanceMeters: Number(distance.toFixed(1)), timestamp });
      }
    }
    this.#tripStates.set(tripId, next);
    for (const event of events) {
      logger.info({ tripId, geofenceId: event.geofenceId, name: event.geofenceName, eventType: event.eventType }, '[GeofenceEvaluator] Observed fence transition');
    }
    return events;
  }

  /** Configuration removal clears membership without fabricating an observed EXIT. */
  removeGeofence(id) {
    identifier(id, 'geofence id');
    if (!this.#geofences.delete(id)) return false;
    for (const ids of this.#tripStates.values()) ids.delete(id);
    return true;
  }

  clearTrip(tripId) {
    identifier(tripId, 'trip id');
    this.#tripStates.delete(tripId);
  }
}

export default GeofenceEvaluator;
