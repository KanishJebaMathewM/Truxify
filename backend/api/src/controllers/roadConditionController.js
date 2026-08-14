import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { reportGripDataSchema } from '../validation/requestSchemas.js';

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
    const { lat, lng, radius_miles = 50 } = req.query;

    if (lat === undefined || lat === null || lat === '' || lng === undefined || lng === null || lng === '') {
      return res.status(400).json({ error: 'Latitude (lat) and longitude (lng) are required' });
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    const radiusMiles = Number(radius_miles);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return res.status(400).json({ error: 'Invalid latitude: must be a finite number in [-90, 90]' });
    }

    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Invalid longitude: must be a finite number in [-180, 180]' });
    }

    if (!Number.isFinite(radiusMiles) || radiusMiles <= 0 || radiusMiles > 1000) {
      return res.status(400).json({ error: 'Invalid radius_miles: must be a finite number in (0, 1000]' });
    }

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
