/**
 * Driver controller.
 *
 * Handlers for the driver resource endpoints added in driverRoutes.js:
 *   GET /api/driver/:driverId        -> getDriverById
 *   GET /api/driver/:driverId/trips  -> getDriverTrips
 *   PUT /api/driver/:driverId        -> updateDriver
 *
 * Every handler enforces object-level authorization: a driver may only read
 * or update their own profile/trips, admins may operate on any driver.
 */
import { supabase, supabaseAdmin, createUserClient } from '../config/db.js';
import logger from '../middleware/logger.js';

function isAdmin(req) {
  return req.user && req.user.role === 'admin';
}

function assertCanAccess(req, driverId, res) {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return false;
  }
  if (!isAdmin(req) && req.user.id !== driverId) {
    res.status(403).json({ error: 'Access denied. You can only access your own driver profile.' });
    return false;
  }
  return true;
}

/**
 * GET /api/driver/:driverId
 * Returns a driver's public profile and driver_details for the authenticated
 * driver (or admin). Uses the user-scoped client so RLS applies.
 */
export async function getDriverById(req, res) {
  try {
    const { driverId } = req.params;
    if (!assertCanAccess(req, driverId, res)) return;

    const db = isAdmin(req) ? (supabaseAdmin || supabase) : (createUserClient(req.token) || supabase);
    const { data: profile, error: profileErr } = await db
      .from('profiles')
      .select('id, full_name, phone, email')
      .eq('id', driverId)
      .maybeSingle();

    if (profileErr || !profile) {
      return res.status(404).json({ error: 'Driver profile not found.' });
    }

    const { data: details, error: detailsErr } = await db
      .from('driver_details')
      .select('rating, total_trips, completion_rate, is_online, truck_id, kyc_status')
      .eq('user_id', driverId)
      .maybeSingle();

    if (detailsErr) {
      return res.status(500).json({ error: 'Failed to fetch driver details.', details: detailsErr.message });
    }

    return res.json({
      profile,
      driverDetails: details || { rating: 0, total_trips: 0, is_online: false, kyc_status: 'Unverified' }
    });
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, '[Driver] getDriverById error');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * GET /api/driver/:driverId/trips
 * Returns paginated trips for a driver, scoped to the requesting driver
 * (or any driver for admins).
 */
export async function getDriverTrips(req, res) {
  try {
    const { driverId } = req.params;
    if (!assertCanAccess(req, driverId, res)) return;

    const pageParam = req.query.page ?? '1';
    const limitParam = req.query.limit ?? '10';

    if (typeof pageParam !== 'string' || !/^\d+$/.test(pageParam)) {
      return res.status(400).json({ error: 'page must be a positive integer' });
    }
    if (typeof limitParam !== 'string' || !/^\d+$/.test(limitParam)) {
      return res.status(400).json({ error: 'limit must be a positive integer' });
    }

    const page = parseInt(pageParam, 10);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam, 10)));
    if (page < 1) {
      return res.status(400).json({ error: 'page must be a positive integer' });
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const db = isAdmin(req) ? (supabaseAdmin || supabase) : (createUserClient(req.token) || supabase);
    const { data: trips, error, count } = await db
      .from('trips')
      .select('*', { count: 'exact' })
      .eq('driver_id', driverId)
      .order('trip_date', { ascending: false })
      .range(from, to);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch trips.', details: error.message });
    }

    return res.json({
      page,
      limit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      trips: trips || []
    });
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, '[Driver] getDriverTrips error');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * PUT /api/driver/:driverId
 * Updates a driver's profile fields. The requesting driver can only update
 * their own profile; admins may update any driver.
 */
export async function updateDriver(req, res) {
  try {
    const { driverId } = req.params;
    if (!assertCanAccess(req, driverId, res)) return;

    const UPDATABLE_FIELDS = new Set([
      'name', 'full_name', 'phone', 'email'
    ]);

    const patch = {};
    for (const [key, value] of Object.entries(req.body || {})) {
      if (UPDATABLE_FIELDS.has(key)) patch[key] = value;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    patch.updated_at = new Date().toISOString();

    const db = isAdmin(req) ? (supabaseAdmin || supabase) : (createUserClient(req.token) || supabase);
    const { data: profile, error: profileErr } = await db
      .from('profiles')
      .update(patch)
      .eq('id', driverId)
      .select('id, full_name, phone, email')
      .maybeSingle();

    if (profileErr) {
      return res.status(500).json({ error: 'Failed to update driver profile.', details: profileErr.message });
    }
    if (!profile) {
      return res.status(404).json({ error: 'Driver profile not found.' });
    }

    return res.json({
      message: 'Driver profile updated successfully.',
      profile
    });
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, '[Driver] updateDriver error');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

export default { getDriverById, getDriverTrips, updateDriver };