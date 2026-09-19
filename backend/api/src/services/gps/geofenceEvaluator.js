import logger from '../../middleware/logger.js';

export const EARTH_RADIUS_METERS = 6371008.8;

/**
 * Calculates great-circle distance between two coordinates in meters (Haversine formula).
 * 
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Distance in meters
 */
export function calculateHaversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export class GeofenceEvaluator {
  constructor() {
    this.geofences = new Map(); // geofenceId -> { id, lat, lng, radiusMeters, name, type }
    this.tripStates = new Map(); // tripId -> Set<geofenceId> (currently inside)
  }

  /**
   * Registers or updates a geofence boundary.
   * 
   * @param {object} geofence - { id, lat, lng, radiusMeters, name, type }
   */
  registerGeofence(geofence) {
    this.geofences.set(geofence.id, {
      id: geofence.id,
      lat: geofence.lat,
      lng: geofence.lng,
      radiusMeters: geofence.radiusMeters || 500, // Default 500m radius
      name: geofence.name || 'Geofence Perimeter',
      type: geofence.type || 'WAYPOINT', // PICKUP, TOLL_PLAZA, WAYPOINT, DELIVERY
    });
  }

  /**
   * Evaluates an incoming vehicle GPS coordinate against all registered geofences.
   * 
   * @param {string} tripId
   * @param {number} lat - Current vehicle latitude
   * @param {number} lng - Current vehicle longitude
   * @returns {Array<object>} Array of geofence events triggered (ENTER, EXIT, DWELL)
   */
  evaluateLocation(tripId, lat, lng) {
    if (!this.tripStates.has(tripId)) {
      this.tripStates.set(tripId, new Set());
    }

    const currentInsideSet = this.tripStates.get(tripId);
    const events = [];

    for (const [id, fence] of this.geofences.entries()) {
      const distance = calculateHaversineDistanceMeters(lat, lng, fence.lat, fence.lng);
      const isInside = distance <= fence.radiusMeters;
      const wasInside = currentInsideSet.has(id);

      if (isInside && !wasInside) {
        // GEOFENCE_ENTER Event
        currentInsideSet.add(id);
        events.push({
          eventType: 'GEOFENCE_ENTER',
          tripId,
          geofenceId: id,
          geofenceName: fence.name,
          geofenceType: fence.type,
          distanceMeters: Number(distance.toFixed(1)),
          timestamp: new Date().toISOString(),
        });
        logger.info({ tripId, geofenceId: id, name: fence.name }, '[GeofenceEvaluator] Vehicle entered geofence');
      } else if (!isInside && wasInside) {
        // GEOFENCE_EXIT Event
        currentInsideSet.delete(id);
        events.push({
          eventType: 'GEOFENCE_EXIT',
          tripId,
          geofenceId: id,
          geofenceName: fence.name,
          geofenceType: fence.type,
          distanceMeters: Number(distance.toFixed(1)),
          timestamp: new Date().toISOString(),
        });
        logger.info({ tripId, geofenceId: id, name: fence.name }, '[GeofenceEvaluator] Vehicle exited geofence');
      } else if (isInside && wasInside) {
        // GEOFENCE_DWELL Event (optional, emitted if needed)
      }
    }

    return events;
  }

  /**
   * Cleans up tracking state for a completed trip.
   * @param {string} tripId
   */
  clearTrip(tripId) {
    this.tripStates.delete(tripId);
  }
}

export default GeofenceEvaluator;
