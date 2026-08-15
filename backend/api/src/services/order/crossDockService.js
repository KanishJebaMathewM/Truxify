/**
 * Cross-docking synchronization engine (#6181).
 *
 * A cross-dock transfer lets the driver currently carrying a load ("from_driver")
 * hand it off to another driver ("to_driver") at a meeting point, so a long-haul
 * load can be relayed to its destination without intermediate storage.
 *
 * Lifecycle:
 *   requested  -> to_driver has been proposed, awaiting accept/decline
 *   accepted   -> to_driver accepted, awaiting handoff verification (OTP)
 *   verified   -> to_driver submitted the one-time handoff code; handoff done
 *   declined   -> to_driver declined the request
 *   cancelled  -> from_driver cancelled an open request
 *   expired    -> request/acceptance window elapsed without handoff
 *
 * The handoff code is stored only as a scrypt hash; the cleartext is returned
 * to the from_driver once at request time so they can share it out-of-band.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '../../config/db.js';
import { DomainError } from './domainError.js';
import { measureExecution } from '../../core/performanceMetrics.js';
import { hashOtp, verifyOtpHash } from '../../lib/otpHashing.js';
import logger from '../../middleware/logger.js';
import { sendPushNotification } from '../notificationService.js';

export { DomainError } from './domainError.js';

const CROSS_DOCK_STATUSES = Object.freeze({
  REQUESTED: 'requested',
  ACCEPTED: 'accepted',
  VERIFIED: 'verified',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});

const TERMINAL_STATUSES = new Set([
  CROSS_DOCK_STATUSES.VERIFIED,
  CROSS_DOCK_STATUSES.DECLINED,
  CROSS_DOCK_STATUSES.CANCELLED,
  CROSS_DOCK_STATUSES.EXPIRED,
]);

// Handoff window the from_driver has to get the load to the cross-dock point
// after the to_driver accepts. Tunable via env for ops.
const ACCEPT_WINDOW_MINUTES = parseInt(process.env.CROSS_DOCK_REQUEST_WINDOW_MINUTES || '60', 10);
const HANDOFF_WINDOW_MINUTES = parseInt(process.env.CROSS_DOCK_HANDOFF_WINDOW_MINUTES || '240', 10);
const OTP_TTL_MINUTES = parseInt(process.env.CROSS_DOCK_OTP_TTL_MINUTES || '30', 10);
const MAX_OTP_ATTEMPTS = parseInt(process.env.CROSS_DOCK_OTP_MAX_ATTEMPTS || '5', 10);
const SEARCH_RADIUS_KM = parseFloat(process.env.CROSS_DOCK_SEARCH_RADIUS_KM || '50');
// How recent a relay driver's location must be to count as "active".
const DRIVER_LOCATION_FRESHNESS_SECONDS = parseInt(process.env.CROSS_DOCK_LOCATION_FRESHNESS_SECONDS || '900', 10);

const TABLE = 'cross_dock_transfers';

function generateHandoffCode() {
  // 6 numeric digits — shareable verbally / over the phone.
  // Use a CSPRNG so the code is unpredictable and not brute-forceable.
  const n = crypto.randomInt(100000, 1000000);
  return String(n);
}

function toIso(date) {
  return date.toISOString();
}

function hoursAhead(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * Haversine distance in km between two lat/lng points. Used for ranking
 * candidate handoff drivers and for sanity-checking the requested cross-dock
 * point; not authoritative for routing.
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Find candidate drivers near a cross-dock point who can take the load onward.
 *
 * @param {object} input
 * @param {string} input.orderId        - Load being relayed.
 * @param {number} input.crossDockLat
 * @param {number} input.crossDockLng
 * @param {string} [input.fromDriverId] - Exclude the current carrier from results.
 * @param {number} [input.radiusKm]
 * @param {number} [input.limit]
 * @returns {Promise<Array<{driver_id, name, distance_km, last_seen_at}>>}
 */
export async function findHandoffCandidates({
  orderId,
  crossDockLat,
  crossDockLng,
  fromDriverId,
  radiusKm = SEARCH_RADIUS_KM,
  limit = 20,
}) {
  return measureExecution('CrossDockService.findHandoffCandidates', async () => {
    if (!orderId) throw new DomainError(400, { error: 'orderId is required.' });
    if (
      typeof crossDockLat !== 'number' ||
      typeof crossDockLng !== 'number' ||
      Number.isNaN(crossDockLat) ||
      Number.isNaN(crossDockLng) ||
      crossDockLat < -90 || crossDockLat > 90 ||
      crossDockLng < -180 || crossDockLng > 180
    ) {
      throw new DomainError(400, { error: 'Invalid cross-dock coordinates.' });
    }

    // Reuse the nearby-drivers RPC if the DB exposes one; fall back to a
    // client-side filter otherwise. The RPC is the production path.
    // Note: the RPC returns a set of rows (an array), so we must NOT call
    // .maybeSingle() on it — that would treat the array as a single object and
    // throw, silently forcing the fallback path. We read the array directly.
    const { data: rpcDrivers, error: rpcError } = await supabaseAdmin.rpc('get_nearby_active_drivers', {
      origin_lat: crossDockLat,
      origin_lng: crossDockLng,
      radius_meters: radiusKm * 1000,
      freshness_seconds: DRIVER_LOCATION_FRESHNESS_SECONDS,
    });

    let drivers = [];
    if (!rpcError && Array.isArray(rpcDrivers)) {
      drivers = rpcDrivers;
    } else if (rpcError) {
      logger.error?.({ err: rpcError.message }, '[cross-dock] nearby-drivers RPC unavailable, using fallback');
    }

    if (drivers.length === 0) {
      const { data: onlineDrivers, error: qErr } = await supabaseAdmin
        .from('driver_locations')
        .select('driver_id, latitude, longitude, last_updated_at, profiles:driver_id (full_name)')
        .eq('is_active', true)
        .limit(limit * 4);
      if (qErr) {
        throw new new DomainError(503, { error: 'Failed to query nearby drivers.', details: qErr.message });
      }
      drivers = (onlineDrivers || [])
        .map((d) => ({
          driver_id: d.driver_id,
          name: d.profiles?.full_name,
          lat: Number(d.latitude),
          lng: Number(d.longitude),
          last_seen_at: d.last_updated_at,
        }))
        .filter((d) => d.driver_id !== fromDriverId)
        .map((d) => ({
          driver_id: d.driver_id,
          name: d.name,
          distance_km: haversineKm(crossDockLat, crossDockLng, d.lat, d.lng),
          last_seen_at: d.last_seen_at,
        }))
        .filter((d) => d.distance_km <= radiusKm)
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, limit);
    } else {
      drivers = drivers
        .filter((d) => d.driver_id !== fromDriverId)
        .slice(0, limit);
    }

    return drivers;
  });
}

/**
 * Create a cross-dock transfer request. Returns the one-time handoff code so
 * the from_driver can share it out-of-band; the code is never stored cleartext.
 */
export async function createTransferRequest({
  orderId,
  fromDriverId,
  toDriverId,
  crossDockLat,
  crossDockLng,
  crossDockNote,
}) {
  return measureExecution('CrossDockService.createTransferRequest', async () => {
    if (fromDriverId === toDriverId) {
      throw new DomainError(400, { error: 'Cannot request a cross-dock handoff to yourself.' });
    }

    // Ensure the proposed handoff driver is a real, active driver. Prevents
    // dispatching a load to a non-existent or invalid recipient.
    const { data: toDriver, error: toErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', toDriverId)
      .maybeSingle();
    if (toErr) {
      throw new DomainError(500, { error: 'Failed to verify handoff driver.', details: toErr.message });
    }
    if (!toDriver) {
      throw new DomainError(400, { error: 'Proposed handoff driver does not exist.' });
    }
    if (toDriver.role !== 'driver') {
      throw new DomainError(400, { error: 'A cross-dock handoff can only target a driver.' });
    }

    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('id, status, customer_id')
      .eq('id', orderId)
      .maybeSingle();
    if (orderErr) {
      throw new DomainError(500, { error: 'Failed to verify load.', details: orderErr.message });
    }
    if (!order) {
      throw new DomainError(404, { error: 'Load not found.' });
    }

    // Only a load that is actually in transit can be relayed.
    if (!['assigned', 'in_transit', 'en_route'].includes(order.status)) {
      throw new DomainError(409, {
        error: `Load is not in transit (status=${order.status}); cannot initiate a cross-dock handoff.`,
      });
    }

    // Confirm the from_driver is the one currently carrying the load.
    const { data: activeTrip, error: tripErr } = await supabaseAdmin
      .from('trips')
      .select('id, driver_id, status')
      .eq('order_id', orderId)
      .in('status', ['assigned', 'in_progress', 'en_route'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tripErr) {
      throw new DomainError(500, { error: 'Failed to verify active trip.', details: tripErr.message });
    }
    if (!activeTrip || activeTrip.driver_id !== fromDriverId) {
      throw new DomainError(403, { error: 'Only the driver currently carrying this load may initiate a cross-dock handoff.' });
    }

    // Enforce the unique-active-transfer-per-order constraint up front so the
    // error path is a clean 409 instead of a raw Postgres violation.
    const { data: existing } = await supabaseAdmin
      .from(TABLE)
      .select('id, status')
      .eq('order_id', orderId)
      .in('status', ['requested', 'accepted'])
      .maybeSingle();
    if (existing) {
      throw new DomainError(409, { error: 'An active cross-dock transfer already exists for this load.' });
    }

    const handoffCode = generateHandoffCode();
    const { hash, salt } = hashOtp(handoffCode);
    const now = new Date();

    const { data: transfer, error: insertErr } = await supabaseAdmin
      .from(TABLE)
      .insert({
        order_id: orderId,
        from_driver_id: fromDriverId,
        to_driver_id: toDriverId,
        cross_dock_lat: crossDockLat,
        cross_dock_lng: crossDockLng,
        cross_dock_note: crossDockNote || null,
        status: CROSS_DOCK_STATUSES.REQUESTED,
        otp_hash: `${hash}:${salt}`,
        otp_expires_at: toIso(new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000)),
        otp_attempts: 0,
        expires_at: toIso(hoursAhead(ACCEPT_WINDOW_MINUTES / 60)),
      })
      .select('id, status, from_driver_id, to_driver_id, cross_dock_lat, cross_dock_lng, expires_at, created_at')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        throw new DomainError(409, { error: 'An active cross-dock transfer already exists for this load.' });
      }
      throw new DomainError(500, { error: 'Failed to create cross-dock transfer.', details: insertErr.message });
    }

    try {
      await sendPushNotification(
        toDriverId,
        'Cross-dock handoff request',
        'You have a new cross-dock handoff request. Review and accept to proceed.',
        'cross_dock_request',
        { transfer_id: transfer.id, order_id: orderId }
      );
    } catch (notifErr) {
      // Notification is best-effort; the transfer is still created.
      logger.warn?.({ err: notifErr.message }, '[cross-dock] handoff request notification failed');
    }

    return { ...transfer, handoff_code: handoffCode };
  });
}

/**
 * To-driver accepts a requested handoff. Moves the window into the handoff
 * phase (OTP verification).
 */
export async function acceptTransferRequest({ transferId, driverId }) {
  return measureExecution('CrossDockService.acceptTransferRequest', async () => {
    const transfer = await loadForDriver(transferId, driverId);
    assertNotExpired(transfer);

    if (transfer.status !== CROSS_DOCK_STATUSES.REQUESTED) {
      throw new DomainError(409, { error: `Transfer is not in a requested state (status=${transfer.status}).` });
    }
    if (transfer.to_driver_id !== driverId) {
      throw new DomainError(403, { error: 'Only the proposed handoff driver may accept this request.' });
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from(TABLE)
      .update({
        status: CROSS_DOCK_STATUSES.ACCEPTED,
        expires_at: toIso(hoursAhead(HANDOFF_WINDOW_MINUTES / 60)),
        otp_expires_at: toIso(new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000)),
        otp_attempts: 0,
      })
      .eq('id', transferId)
      .eq('status', CROSS_DOCK_STATUSES.REQUESTED)
      .select('id, status, from_driver_id, to_driver_id, order_id, expires_at, otp_expires_at')
      .single();

    if (updErr || !updated) {
      throw new DomainError(409, { error: 'Transfer was modified concurrently; please retry.' });
    }

    try {
      await sendPushNotification(
        updated.from_driver_id,
        'Cross-dock handoff accepted',
        'Your handoff driver has accepted. Proceed to the cross-dock meeting point.',
        'cross_dock_accepted',
        { transfer_id: transferId, order_id: updated.order_id }
      );
    } catch (notifErr) {
      logger.warn?.({ err: notifErr.message }, '[cross-dock] accept notification failed');
    }

    return updated;
  });
}

/**
 * To-driver declines a requested handoff. Terminal.
 */
export async function declineTransferRequest({ transferId, driverId }) {
  return measureExecution('CrossDockService.declineTransferRequest', async () => {
    const transfer = await loadForDriver(transferId, driverId);
    if (transfer.to_driver_id !== driverId) {
      throw new DomainError(403, { error: 'Only the proposed handoff driver may decline this request.' });
    }
    if (transfer.status !== CROSS_DOCK_STATUSES.REQUESTED) {
      throw new DomainError(409, { error: `Transfer is not in a requested state (status=${transfer.status}).` });
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from(TABLE)
      .update({ status: CROSS_DOCK_STATUSES.DECLINED })
      .eq('id', transferId)
      .eq('status', CROSS_DOCK_STATUSES.REQUESTED)
      .select('id, status, from_driver_id, order_id')
      .single();

    if (updErr || !updated) {
      throw new DomainError(409, { error: 'Transfer was modified concurrently; please retry.' });
    }

    try {
      await sendPushNotification(
        updated.from_driver_id,
        'Cross-dock handoff declined',
        'Your proposed handoff driver declined the cross-dock request.',
        'cross_dock_declined',
        { transfer_id: transferId, order_id: updated.order_id }
      );
    } catch (notifErr) {
      logger.warn?.({ err: notifErr.message }, '[cross-dock] decline notification failed');
    }

    return updated;
  });
}

/**
 * From-driver cancels an open (requested or accepted) handoff. Terminal.
 */
export async function cancelTransferRequest({ transferId, driverId }) {
  return measureExecution('CrossDockService.cancelTransferRequest', async () => {
    const transfer = await loadForDriver(transferId, driverId);
    if (transfer.from_driver_id !== driverId) {
      throw new DomainError(403, { error: 'Only the originating driver may cancel this request.' });
    }
    if (transfer.status === CROSS_DOCK_STATUSES.VERIFIED) {
      throw new DomainError(409, { error: 'Cannot cancel a completed handoff.' });
    }
    if (TERMINAL_STATUSES.has(transfer.status)) {
      throw new DomainError(409, { error: `Transfer is already terminal (status=${transfer.status}).` });
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from(TABLE)
      .update({ status: CROSS_DOCK_STATUSES.CANCELLED })
      .eq('id', transferId)
      .in('status', [CROSS_DOCK_STATUSES.REQUESTED, CROSS_DOCK_STATUSES.ACCEPTED])
      .select('id, status, to_driver_id, order_id')
      .single();

    if (updErr || !updated) {
      throw new DomainError(409, { error: 'Transfer was modified concurrently; please retry.' });
    }

    try {
      await sendPushNotification(
        updated.to_driver_id,
        'Cross-dock handoff cancelled',
        'The originating driver cancelled the cross-dock handoff request.',
        'cross_dock_cancelled',
        { transfer_id: transferId, order_id: updated.order_id }
      );
    } catch (notifErr) {
      logger.warn?.({ err: notifErr.message }, '[cross-dock] cancel notification failed');
    }

    return updated;
  });
}

/**
 * Verify the handoff: the to-driver submits the one-time code shared by the
 * from_driver. On success the transfer is marked verified. Code is matched
 * in constant time and the OTP is single-use.
 */
export async function verifyHandoff({ transferId, driverId, handoffCode }) {
  return measureExecution('CrossDockService.verifyHandoff', async () => {
    if (!handoffCode) {
      throw new DomainError(400, { error: 'Handoff code is required.' });
    }
    const transfer = await loadForDriver(transferId, driverId);
    assertNotExpired(transfer);

    if (transfer.to_driver_id !== driverId) {
      throw new DomainError(403, { error: 'Only the receiving driver may verify the handoff.' });
    }
    if (transfer.status !== CROSS_DOCK_STATUSES.ACCEPTED) {
      throw new DomainError(409, { error: `Handoff can only be verified from an accepted state (status=${transfer.status}).` });
    }
    if (!transfer.otp_hash) {
      throw new DomainError(409, { error: 'No handoff code is associated with this transfer.' });
    }

    // Explicit defence-in-depth: reject a stale handoff code even if the
    // transfer's overall window has not yet elapsed.
    const otpExpiresAt = transfer.otp_expires_at ? Date.parse(transfer.otp_expires_at) : NaN;
    if (!Number.isNaN(otpExpiresAt) && Date.now() > otpExpiresAt) {
      throw new DomainError(410, { error: 'The handoff code for this transfer has expired.' });
    }

    const [hash, salt] = String(transfer.otp_hash).split(':');
    const matches = verifyOtpHash(handoffCode, { otp_hash: hash, otp_salt: salt });
    const attempts = (transfer.otp_attempts || 0) + 1;

    if (!matches) {
      const exhausted = attempts >= MAX_OTP_ATTEMPTS;
      const { error: updErr } = await supabaseAdmin
        .from(TABLE)
        .update({
          otp_attempts: attempts,
          status: exhausted ? CROSS_DOCK_STATUSES.DECLINED : transfer.status,
        })
        .eq('id', transferId)
        .eq('status', transfer.status);
      if (updErr) {
        logger.error?.({ err: updErr.message }, '[cross-dock] failed to record bad handoff attempt');
      }
      if (exhausted) {
        throw new DomainError(403, { error: 'Too many incorrect handoff attempts; transfer declined.' });
      }
      throw new DomainError(403, { error: 'Invalid handoff code.' });
    }

    const { data: verified, error: updErr } = await supabaseAdmin
      .from(TABLE)
      .update({
        status: CROSS_DOCK_STATUSES.VERIFIED,
        verified_at: toIso(new Date()),
        otp_attempts: attempts,
      })
      .eq('id', transferId)
      .eq('status', CROSS_DOCK_STATUSES.ACCEPTED)
      .select('id, status, from_driver_id, to_driver_id, order_id, verified_at')
      .single();

    if (updErr || !verified) {
      throw new DomainError(409, { error: 'Transfer was modified concurrently; please retry.' });
    }

    // Reassign order custody to the receiving driver now that handoff is verified.
    if (verified.order_id) {
      const { error: orderErr } = await supabaseAdmin
        .from('orders')
        .update({ driver_id: verified.to_driver_id })
        .eq('id', verified.order_id)
        .eq('driver_id', verified.from_driver_id); // Only update if still assigned to from_driver
      if (orderErr) {
        logger.warn?.({ err: orderErr.message, orderId: verified.order_id, toDriverId: verified.to_driver_id }, '[cross-dock] failed to reassign order custody');
      }
    }

    try {
      await sendPushNotification(
        verified.from_driver_id,
        'Cross-dock handoff verified',
        'The receiving driver verified the handoff. Load custody transferred.',
        'cross_dock_verified',
        { transfer_id: transferId, order_id: verified.order_id }
      );
    } catch (notifErr) {
      logger.warn?.({ err: notifErr.message }, '[cross-dock] verify notification failed');
    }

    return verified;
  });
}

/**
 * Retrieve a single transfer, scoped to a participating driver. Authorization
 * is enforced by the policy layer; this guard is defense-in-depth.
 */
export async function getTransfer({ transferId, driverId }) {
  return loadForDriver(transferId, driverId);
}

/**
 * List transfers involving a driver, optionally filtered by status.
 */
export async function listTransfers({ driverId, status, limit = 50 }) {
  if (!driverId) throw new DomainError(400, { error: 'driverId is required.' });
  let query = supabaseAdmin
    .from(TABLE)
    .select('id, order_id, from_driver_id, to_driver_id, status, cross_dock_lat, cross_dock_lng, created_at, verified_at, expires_at')
    .or(`from_driver_id.eq.${driverId},to_driver_id.eq.${driverId}`)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 200));
  if (status) {
    if (!Object.values(CROSS_DOCK_STATUSES).includes(status)) {
      throw new DomainError(400, { error: 'Invalid status filter.' });
    }
    query = query.eq('status', status);
  }
  const { data, error } = await query;
  if (error) {
    throw new DomainError(500, { error: 'Failed to list transfers.', details: error.message });
  }
  return data || [];
}

async function loadForDriver(transferId, driverId) {
  if (!transferId || !driverId) {
    throw new DomainError(400, { error: 'transferId and driverId are required.' });
  }
  const { data: transfer, error } = await supabaseAdmin
    .from(TABLE)
    .select('id, order_id, from_driver_id, to_driver_id, status, cross_dock_lat, cross_dock_lng, cross_dock_note, otp_hash, otp_attempts, otp_expires_at, expires_at, created_at, verified_at')
    .eq('id', transferId)
    .or(`from_driver_id.eq.${driverId},to_driver_id.eq.${driverId}`)
    .maybeSingle();
  if (error) {
    throw new DomainError(500, { error: 'Failed to load transfer.', details: error.message });
  }
  if (!transfer) {
    throw new DomainError(404, { error: 'Transfer not found or you are not a participant.' });
  }
  return transfer;
}

function assertNotExpired(transfer) {
  const now = Date.now();
  const expiresAt = transfer.expires_at ? Date.parse(transfer.expires_at) : NaN;
  const otpExpiresAt = transfer.otp_expires_at ? Date.parse(transfer.otp_expires_at) : NaN;
  if (!Number.isNaN(expiresAt) && now > expiresAt) {
    // Best-effort mark expired so the unique-active constraint frees the order.
    supabaseAdmin
      .from(TABLE)
      .update({ status: CROSS_DOCK_STATUSES.EXPIRED })
      .eq('id', transfer.id)
      .in('status', [CROSS_DOCK_STATUSES.REQUESTED, CROSS_DOCK_STATUSES.ACCEPTED])
      .then(() => {}, (e) => logger.warn?.({ err: e.message }, '[cross-dock] failed to mark expired'));
    throw new DomainError(410, { error: 'This cross-dock transfer window has expired.' });
  }
  // An accepted transfer whose OTP has expired is also unusable but stays
  // cancellable by the from_driver; we surface it as a 410 here.
  if (
    transfer.status === CROSS_DOCK_STATUSES.ACCEPTED &&
    !Number.isNaN(otpExpiresAt) &&
    now > otpExpiresAt
  ) {
    throw new DomainError(410, { error: 'The handoff code for this transfer has expired.' });
  }
}

export const __testing = {
  generateHandoffCode,
  ACCEPT_WINDOW_MINUTES,
  HANDOFF_WINDOW_MINUTES,
  OTP_TTL_MINUTES,
  MAX_OTP_ATTEMPTS,
};
