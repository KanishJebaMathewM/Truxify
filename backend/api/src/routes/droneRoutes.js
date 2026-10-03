import express from 'express';
import { droneService } from '../services/droneService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

export const MAX_DRONE_FLIGHT_RADIUS_KM = 25.0; // 25 km max flight radius for last-mile multicopter
export const ALLOWED_LAUNCH_ROLES = Object.freeze(['driver', 'dispatcher', 'admin']);
export const MISSION_ID_REGEX = /^MSN-[a-zA-Z0-9_\-]{8,64}$/;
export const ENTITY_ID_REGEX = /^[a-zA-Z0-9_\-:.]{1,64}$/;

/**
 * Validates GPS coordinate object structure.
 * @param {Object} coord - { lat, lng }
 */
export const isValidGpsCoordinate = (coord) => {
  if (!coord || typeof coord !== 'object') return false;
  const { lat, lng } = coord;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

/**
 * Calculates Great-Circle flight distance between two GPS coordinates using Haversine formula.
 * @returns {number} Distance in kilometers
 */
export const calculateFlightDistanceKm = (start, dest) => {
  const toRad = (val) => (val * Math.PI) / 180;
  const R = 6371; // Earth radius in km

  const dLat = toRad(dest.lat - start.lat);
  const dLng = toRad(dest.lng - start.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(start.lat)) *
      Math.cos(toRad(dest.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Validates mission identifier format.
 */
export const isValidMissionId = (missionId) => {
  return typeof missionId === 'string' && MISSION_ID_REGEX.test(missionId.trim());
};

/**
 * POST /api/drone/launch
 * Coordinates launch of automated drone for last-mile handoff.
 * Restricted to drivers, dispatchers, and admins with pre-flight safety checks.
 */
router.post('/launch', authenticate, userLimiter, async (req, res) => {
  try {
    if (req.user && req.user.role && !ALLOWED_LAUNCH_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access Denied: Only ${ALLOWED_LAUNCH_ROLES.join(', ')} roles are authorized to command drone launches`
      });
    }

    const { trip_id, parcel_id, safe_zone_gps, destination_gps } = req.body;

    if (!trip_id || !parcel_id || !safe_zone_gps || !destination_gps) {
      return res.status(400).json({ error: 'Missing required parameters: trip_id, parcel_id, safe_zone_gps, destination_gps' });
    }

    if (!ENTITY_ID_REGEX.test(String(trip_id).trim()) || !ENTITY_ID_REGEX.test(String(parcel_id).trim())) {
      return res.status(400).json({ error: 'trip_id and parcel_id must be valid alphanumeric identifiers (1-64 chars)' });
    }

    if (!isValidGpsCoordinate(safe_zone_gps)) {
      return res.status(400).json({ error: 'safe_zone_gps must contain valid latitude [-90, 90] and longitude [-180, 180]' });
    }

    if (!isValidGpsCoordinate(destination_gps)) {
      return res.status(400).json({ error: 'destination_gps must contain valid latitude [-90, 90] and longitude [-180, 180]' });
    }

    // Pre-flight distance calculation
    const flightDistanceKm = calculateFlightDistanceKm(safe_zone_gps, destination_gps);
    if (flightDistanceKm > MAX_DRONE_FLIGHT_RADIUS_KM) {
      return res.status(400).json({
        error: `Flight distance of ${flightDistanceKm.toFixed(2)} km exceeds maximum permissible drone flight radius of ${MAX_DRONE_FLIGHT_RADIUS_KM} km`,
        flightDistanceKm: Number(flightDistanceKm.toFixed(2)),
        maxRadiusKm: MAX_DRONE_FLIGHT_RADIUS_KM
      });
    }

    const mission = await droneService.launchDroneDelivery({
      ownerId: req.user.id,
      tripId: String(trip_id).trim(),
      parcelId: String(parcel_id).trim(),
      safeZoneGps: safe_zone_gps,
      destinationGps: destination_gps
    });

    return res.status(201).json({
      message: 'Drone delivery handoff launched successfully',
      flightDistanceKm: Number(flightDistanceKm.toFixed(2)),
      mission
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to launch drone delivery handoff' });
  }
});

/**
 * GET /api/drone/telemetry/:missionId
 * Fetches real-time telemetry status for a drone delivery mission.
 */
router.get('/telemetry/:missionId', authenticate, userLimiter, async (req, res) => {
  try {
    const { missionId } = req.params;

    if (!isValidMissionId(missionId)) {
      return res.status(400).json({ error: 'Invalid missionId format. Expected MSN-<id>' });
    }

    const telemetry = await droneService.getDroneTelemetry(
      missionId.trim(),
      req.user.role === 'admin' ? null : req.user.id
    );

    if (!telemetry) {
      return res.status(404).json({ error: 'Drone mission not found or inactive' });
    }

    return res.json({ telemetry });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch drone telemetry' });
  }
});

/**
 * POST /api/drone/abort/:missionId
 * Emergency recall or abort of an active drone delivery mission.
 */
router.post('/abort/:missionId', authenticate, userLimiter, async (req, res) => {
  try {
    const { missionId } = req.params;

    if (!isValidMissionId(missionId)) {
      return res.status(400).json({ error: 'Invalid missionId format' });
    }

    const telemetry = await droneService.getDroneTelemetry(
      missionId.trim(),
      req.user.role === 'admin' ? null : req.user.id
    );

    if (!telemetry) {
      return res.status(404).json({ error: 'Drone mission not found or not owned by user' });
    }

    // Mark mission as aborted
    telemetry.status = 'ABORTED_RETURNING_TO_BASE';
    telemetry.abortedAt = new Date().toISOString();

    return res.json({
      message: 'Drone mission aborted. Aircraft returning to safe zone base.',
      mission: telemetry
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to abort drone mission' });
  }
});

export default router;
