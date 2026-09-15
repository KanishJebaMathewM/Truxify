import express from 'express';
import { droneService } from '../services/droneService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * POST /api/drone/launch
 * Coordinates launch of automated drone for last-mile handoff
 */
router.post('/launch', authenticate, userLimiter, async (req, res) => {
  try {
    if (req.user.role !== 'driver' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only drivers or admins can launch drone deliveries.' });
    }

    const { trip_id, parcel_id, safe_zone_gps, destination_gps } = req.body;

    if (!trip_id || !parcel_id || !safe_zone_gps || !destination_gps) {
      return res.status(400).json({ error: 'Missing required parameters: trip_id, parcel_id, safe_zone_gps, destination_gps' });
    }

    if (req.user.role !== 'admin') {
      const { supabase } = await import('../config/db.js');
      const { data: trip } = await supabase
        .from('trips')
        .select('driver_id')
        .eq('id', trip_id)
        .maybeSingle();

      if (!trip || trip.driver_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied. You can only launch drones for your own trips.' });
      }
    }

    const mission = await droneService.launchDroneDelivery({
      tripId: trip_id,
      parcelId: parcel_id,
      safeZoneGps: safe_zone_gps,
      destinationGps: destination_gps
    });

    return res.status(201).json({
      message: 'Drone delivery handoff launched successfully',
      mission
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to launch drone delivery handoff' });
  }
});

/**
 * GET /api/drone/telemetry/:missionId
 * Fetches real-time telemetry status for a drone delivery mission
 */
router.get('/telemetry/:missionId', authenticate, userLimiter, async (req, res) => {
  try {
    const { missionId } = req.params;
    const telemetry = await droneService.getDroneTelemetry(missionId);

    if (!telemetry) {
      return res.status(404).json({ error: 'Drone mission not found or inactive' });
    }

    if (req.user.role !== 'admin') {
      const missionOwnerId = telemetry.driver_id || telemetry.user_id;
      if (missionOwnerId && missionOwnerId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied. You do not own this drone mission.' });
      }
    }

    return res.json({ telemetry });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch drone telemetry' });
  }
});

export default router;
