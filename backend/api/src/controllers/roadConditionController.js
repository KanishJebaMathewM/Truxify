import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { reportGripDataSchema, nearbyGripQuerySchema } from '../validation/requestSchemas.js';

export const reportGripData = async (req, res) => {
  try {
    const parseResult = reportGripDataSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parseResult.error });
    }

    const { latitude, longitude, grip_index, slip_events_count } = parseResult.data;

    const { error: insertErr } = await supabaseAdmin
      .from('road_grip_reports')
      .insert({
        latitude,
        longitude,
        grip_index,
        slip_events_count,
        user_id: req.user?.id || null
      });

    if (insertErr) {
      logger.error({ err: insertErr }, 'Failed to insert road grip report');
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(201).json({ success: true, message: 'Grip data reported successfully' });
  } catch (err) {
    logger.error({ err }, 'Internal server error in reportGripData');
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const getNearbyGripData = async (req, res) => {
  try {
    const parseResult = nearbyGripQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      const field = issue?.path.join('.') || 'query';
      const message = issue?.message || 'Invalid value';
      return res.status(400).json({ error: `Invalid ${field}: ${message}` });
    }

    const { lat: latitude, lng: longitude, radius_miles: radiusMiles } = parseResult.data;

    // Approximate bounding box (1 degree is roughly 69 miles)
    const radiusDeg = radiusMiles / 69.0;
    // Clamp the latitude bounds to the valid range so that coordinates near the
    // poles cannot produce an inverted or out-of-range bounding box.
    const minLat = Math.max(-90, latitude - radiusDeg);
    const maxLat = Math.min(90, latitude + radiusDeg);
    // Longitude degree distance varies by latitude; clamp the cos term so that
    // latitudes near ±90 cannot produce an infinite lng span.
    const latRad = latitude * (Math.PI / 180);
    const cosLat = Math.max(Math.abs(Math.cos(latRad)), 0.01);
    const lngDeg = radiusDeg / cosLat;
    const minLng = longitude - lngDeg;
    const maxLng = longitude + lngDeg;

    // Fetch reports from the last 12 hours
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('road_grip_reports')
      .select('id, latitude, longitude, grip_index, slip_events_count, recorded_at')
      .gte('latitude', minLat)
      .lte('latitude', maxLat)
      .gte('longitude', minLng)
      .lte('longitude', maxLng)
      .gte('recorded_at', twelveHoursAgo)
      .order('recorded_at', { ascending: false })
      .limit(100);

    if (error) {
      logger.error({ err: error }, 'Failed to fetch nearby grip data');
      return res.status(500).json({ error: 'Database error' });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error({ err }, 'Internal server error in getNearbyGripData');
    return res.status(500).json({ error: 'Internal server error' });
  }
};
