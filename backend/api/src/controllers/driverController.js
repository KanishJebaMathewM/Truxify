import { supabase, supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { formatPaginationMeta } from '../utils/pagination.js';

/**
 * GET /api/driver/:driverId
 * Retrieves driver profile, details, and active vehicle assignment.
 */
export const getDriverById = async (req, res) => {
  const { driverId } = req.params;

  try {
    const client = supabaseAdmin || supabase;
    if (!client) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }

    const { data: driverDetails, error: detailsError } = await client
      .from('driver_details')
      .select('*')
      .eq('user_id', driverId)
      .maybeSingle();

    if (detailsError) {
      logger.error({ err: detailsError, driverId }, '[driverController] Failed to fetch driver details');
      return res.status(500).json({ error: 'Failed to fetch driver details.' });
    }

    if (!driverDetails) {
      return res.status(404).json({ error: 'Driver not found.' });
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id, full_name, email, phone, role, created_at')
      .eq('id', driverId)
      .maybeSingle();

    if (profileError) {
      logger.warn({ err: profileError, driverId }, '[driverController] Failed to fetch profile details');
    }

    let truck = null;
    if (driverDetails.truck_id) {
      const { data: truckData } = await client
        .from('trucks')
        .select('*')
        .eq('id', driverDetails.truck_id)
        .maybeSingle();
      truck = truckData || null;
    }

    return res.json({
      driver: {
        ...driverDetails,
        profile: profile || null,
        truck,
      },
    });
  } catch (err) {
    logger.error({ err: err.message, driverId }, '[driverController] Error fetching driver by ID');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * GET /api/driver/:driverId/trips
 * Retrieves paginated trip history for the specified driver.
 */
export const getDriverTrips = async (req, res) => {
  const { driverId } = req.params;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  try {
    const client = supabaseAdmin || supabase;
    if (!client) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }

    const { data: trips, error, count } = await client
      .from('trips')
      .select('*', { count: 'exact' })
      .eq('driver_id', driverId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      logger.error({ err: error, driverId }, '[driverController] Failed to fetch driver trips');
      return res.status(500).json({ error: 'Failed to fetch driver trips.' });
    }

    const pagination = formatPaginationMeta(count || 0, page, limit);

    return res.json({
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      totalPages: pagination.totalPages,
      trips: trips || [],
      data: trips || [],
      pagination
    });
  } catch (err) {
    logger.error({ err: err.message, driverId }, '[driverController] Error fetching driver trips');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * PUT /api/driver/:driverId
 * Updates driver profile or settings.
 */
export const updateDriver = async (req, res) => {
  const { driverId } = req.params;

  // Authorization check: driver can update own profile, or user is admin
  if (req.user?.id !== driverId && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: You cannot update another driver profile.' });
  }

  const { is_online, hos_status, truck_id } = req.body;
  const updatePayload = {
    updated_at: new Date().toISOString(),
  };

  const VALID_HOS_STATUSES = ['off_duty', 'on_duty', 'driving', 'resting'];
  if (hos_status !== undefined) {
    if (typeof hos_status !== 'string' || !VALID_HOS_STATUSES.includes(hos_status)) {
      return res.status(400).json({
        error: `Invalid hos_status. Must be one of: ${VALID_HOS_STATUSES.join(', ')}`,
      });
    }
    updatePayload.hos_status = hos_status;
  }

  if (typeof is_online === 'boolean') updatePayload.is_online = is_online;
  if (truck_id !== undefined) updatePayload.truck_id = truck_id;

  try {
    const client = supabaseAdmin || supabase;
    if (!client) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }

    const { data: updated, error } = await client
      .from('driver_details')
      .update(updatePayload)
      .eq('user_id', driverId)
      .select('*')
      .maybeSingle();

    if (error) {
      logger.error({ err: error, driverId }, '[driverController] Failed to update driver');
      return res.status(500).json({ error: 'Failed to update driver details.' });
    }

    if (!updated) {
      return res.status(404).json({ error: 'Driver profile not found.' });
    }

    return res.json({
      message: 'Driver updated successfully.',
      driver: updated,
    });
  } catch (err) {
    logger.error({ err: err.message, driverId }, '[driverController] Error updating driver');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

export default {
  getDriverById,
  getDriverTrips,
  updateDriver,
};
