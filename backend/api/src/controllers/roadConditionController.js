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
      logger.error('Failed to insert road grip report:', insertErr);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(201).json({ success: true, message: 'Grip data reported successfully' });
  } catch (err) {
    logger.error('Internal server error in reportGripData:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const getNearbyGripData = async (req, res) => {
  try {
    const { lat, lng, radius_miles = 50 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude (lat) and longitude (lng) are required' });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ error: 'Invalid latitude or longitude' });
    }
    
    // Approximate bounding box (1 degree is roughly 69 miles)
    const radiusDeg = parseFloat(radius_miles) / 69.0;
    const minLat = latitude - radiusDeg;
    const maxLat = latitude + radiusDeg;
    // Longitude degree distance varies by latitude
    const latRad = latitude * (Math.PI / 180);
    const lngDeg = radiusDeg / Math.cos(latRad);
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
      logger.error('Failed to fetch nearby grip data:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Internal server error in getNearbyGripData:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
