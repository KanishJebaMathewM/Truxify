import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { reportGripDataSchema, nearbyGripQuerySchema } from '../validation/requestSchemas.js';
import { getBoundingBox } from '../utils/coordinates.js';

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

    const { minLat, maxLat, minLng, maxLng } = getBoundingBox(
      latitude, longitude, radiusMiles * 1.609344
    );

    // Fetch reports from the last 12 hours
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

    let query = supabaseAdmin
      .from('road_grip_reports')
      .select('id, latitude, longitude, grip_index, slip_events_count, recorded_at')
      .gte('latitude', minLat)
      .lte('latitude', maxLat);
    // Wrapped intervals contain either side of the date line. A cap touching
    // a pole uses the helper's full [-180, 180] longitude range.
    query = minLng > maxLng
      ? query.or(`longitude.gte.${minLng},longitude.lte.${maxLng}`)
      : query.gte('longitude', minLng).lte('longitude', maxLng);
    const { data, error } = await query
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
