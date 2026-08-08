import { createHash } from 'node:crypto';
import { supabase, supabaseAdmin } from '../../config/db.js';
import { getRouteEstimate } from '../osrm.js';
import { computeOrderPricing } from '../../lib/pricing.js';
import { predictPrice } from '../ml.js';
import { getLiveTrafficMultiplier } from '../trafficService.js';
import { DomainError } from './bidAcceptanceService.js';
import logger from '../../middleware/logger.js';
import { measureExecution } from '../../core/performanceMetrics.js';
import { generateOrderDisplayId, ORDER_DISPLAY_ID_MAX_RETRIES } from '../../lib/orderDisplayId.js';

// Targeting knobs for the new-trip driver broadcast. Env-configurable so a
// burst of order creations can never trigger an unbounded notification fan-out.
const NEW_TRIP_NOTIFY_RADIUS_KM = Number(process.env.NEW_TRIP_NOTIFY_RADIUS_KM) > 0
  ? Number(process.env.NEW_TRIP_NOTIFY_RADIUS_KM)
  : 50;
const NEW_TRIP_NOTIFY_MAX_DRIVERS = Number(process.env.NEW_TRIP_NOTIFY_MAX_DRIVERS) > 0
  ? Number(process.env.NEW_TRIP_NOTIFY_MAX_DRIVERS)
  : 50;
const NEW_TRIP_NOTIFY_BATCH_SIZE = Number(process.env.NEW_TRIP_NOTIFY_BATCH_SIZE) > 0
  ? Number(process.env.NEW_TRIP_NOTIFY_BATCH_SIZE)
  : 25;
const DRIVER_LOCATION_FRESHNESS_MS = 15 * 60 * 1000;

// Durable idempotency: Postgres-backed source of truth for at-most-once order
// creation (see migration 20260807000000_create_order_idempotency_keys_table.sql
// and 20260807010000_extend_create_order_tx_idempotency.sql). The Redis/memory
// middleware is the fast path for in-process dedupe; the claim → create →
// complete sequence runs INSIDE create_order_tx as a single transaction, so a
// crash can never leave a half-created order and a retry always replays the
// original response. Key reuse with a different payload is rejected (fingerprint
// mismatch) so a client cannot accidentally create a different order under the
// same key.
const IDEMPOTENCY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortCanonical(value[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Deterministic fingerprint of a create-order request. Keyed by user so two
 * customers with identical bodies never collide, and normalized over the
 * parsed/validated body so defaulted fields are included stably.
 */
export function deriveRequestFingerprint(userId, body) {
  return createHash('sha256')
    .update(`${userId}:${JSON.stringify(sortCanonical(body))}`)
    .digest('hex');
}

// Bound registry growth: nightly sweep of terminal rows. unref'd so the timer
// never keeps the process alive (same pattern as middleware/idempotency.js).
const idempotencyPruneTimer = setInterval(async () => {
  try {
    await (supabaseAdmin ?? supabase).rpc('prune_order_idempotency_keys', { p_older_than: '7 days' });
  } catch (pruneErr) {
    logger.error(`[orders] Idempotency key pruning failed: ${pruneErr.message}`);
  }
}, IDEMPOTENCY_PRUNE_INTERVAL_MS);
idempotencyPruneTimer.unref();

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Find drivers that should be notified about a new trip: those online and
 * located within the configured radius of the pickup, whose truck can carry
 * the load (by weight capacity). Falls back to in-memory filtering when the
 * drivers are not filterable in a single SQL query.
 *
 * @param {{pickupLat: number, pickupLng: number, weightTonnes: number}} args
 * @returns {Promise<string[]>} driver ids, bounded by NEW_TRIP_NOTIFY_MAX_DRIVERS
 */
async function findTargetDrivers({ pickupLat, pickupLng, weightTonnes }) {
  const { data: locations } = await supabase
    .from('driver_locations')
    .select('driver_id, latitude, longitude')
    .eq('is_active', true)
    .gte('last_updated_at', new Date(Date.now() - DRIVER_LOCATION_FRESHNESS_MS).toISOString())
    .not('latitude', 'is', null);

  if (!locations || locations.length === 0) return [];

  const nearbyDriverIds = locations
    .filter(loc => {
      if (!Number.isFinite(Number(loc.latitude)) || !Number.isFinite(Number(loc.longitude))) return false;
      return haversineDistanceKm(pickupLat, pickupLng, Number(loc.latitude), Number(loc.longitude)) <= NEW_TRIP_NOTIFY_RADIUS_KM;
    })
    .map(loc => loc.driver_id);

  if (nearbyDriverIds.length === 0) return [];

  const { data: driverDetails } = await supabase
    .from('driver_details')
    .select('user_id, truck_id')
    .eq('is_online', true)
    .not('truck_id', 'is', null)
    .in('user_id', nearbyDriverIds);

  if (!driverDetails || driverDetails.length === 0) return [];

  const truckIds = driverDetails.map(d => d.truck_id).filter(Boolean);
  if (truckIds.length === 0) return [];

  const { data: trucks } = await supabase
    .from('trucks')
    .select('id, max_capacity_tons')
    .in('id', truckIds);

  const capacityByTruck = new Map((trucks ?? []).map(t => [t.id, t.max_capacity_tons]));
  const truckByDriver = new Map(driverDetails.map(d => [d.user_id, d.truck_id]));

  const canCarryLoad = driverId => {
    const capacity = capacityByTruck.get(truckByDriver.get(driverId));
    if (capacity == null) return false;
    return Number(capacity) >= weightTonnes;
  };

  return [...new Set(driverDetails.map(d => d.user_id).filter(canCarryLoad))]
    .slice(0, NEW_TRIP_NOTIFY_MAX_DRIVERS);
}

/**
 * Push a targeted new-trip notification to nearby, capacity-matching drivers.
 * Sends in bounded batches, logs per-driver failures, and reports aggregate
 * send stats instead of swallowing errors silently.
 */
async function sendNewTripNotifications({ pickupLat, pickupLng, weightTonnes, pickupAddress, dropAddress, orderDisplayId }) {
  const { sendFcmNotification } = await import('../notificationService.js');

  const driverIds = await findTargetDrivers({ pickupLat, pickupLng, weightTonnes });
  if (driverIds.length === 0) {
    logger.info(`[orders] No targeted drivers within ${NEW_TRIP_NOTIFY_RADIUS_KM}km of pickup for order ${orderDisplayId} — skipping push.`);
    return;
  }

  const notification = {
    title: 'New Trip Available',
    body: `A new trip from ${String(pickupAddress).split(',')[0]} to ${String(dropAddress).split(',')[0]} is available.`,
  };
  const payload = {
    type: 'new_trip',
    orderId: orderDisplayId,
  };

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < driverIds.length; i += NEW_TRIP_NOTIFY_BATCH_SIZE) {
    const batch = driverIds.slice(i, i + NEW_TRIP_NOTIFY_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(driverId => sendFcmNotification(driverId, notification, payload)));
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value?.success) {
        sent += 1;
      } else {
        failed += 1;
        const error = result.status === 'rejected'
          ? result.reason?.message
          : result.value?.error;
        logger.error(`[orders] Push notification failed for driver ${batch[idx]}: ${error || 'unknown error'}`);
      }
    });
  }

  logger.info(`[orders] New trip notifications sent to ${sent}/${driverIds.length} targeted drivers for order ${orderDisplayId} (${failed} failed).`);
}

export async function createOrder({ orderData, userId, user, idempotencyKey = null }) {
  return measureExecution('OrderCreationService.createOrder', async () => {
    const fingerprint = deriveRequestFingerprint(userId, orderData);

    const {
      pickup_address, pickup_lat, pickup_lng,
      drop_address, drop_lat, drop_lng,
      pickup_date, pickup_time,
      goods_type, weight_tonnes, length_ft, width_ft, height_ft,
      is_stackable, is_fragile, special_requirements,
      payment_method_id, upi_id
    } = orderData;

    if (!pickup_address || pickup_lat == null || pickup_lng == null || !drop_address || drop_lat == null || drop_lng == null || !goods_type || weight_tonnes == null) {
      throw new DomainError(400, { error: 'Missing required routing or cargo specification fields.' });
    }

    let pricing;
    try {
      const routeEstimate = await getRouteEstimate({
        pickupLat: Number(pickup_lat),
        pickupLng: Number(pickup_lng),
        dropLat: Number(drop_lat),
        dropLng: Number(drop_lng),
      });
      pricing = computeOrderPricing({
        pickupLat: Number(pickup_lat),
        pickupLng: Number(pickup_lng),
        dropLat: Number(drop_lat),
        dropLng: Number(drop_lng),
        weightTonnes: Number(weight_tonnes),
        roadDistanceKm: routeEstimate?.distanceKm,
        isFragile: Boolean(is_fragile),
        isStackable: Boolean(is_stackable),
      });
    } catch (pricingErr) {
      logger.error('Pricing computation error:', pricingErr.message);
      throw new DomainError(400, {
        error: 'Unable to compute freight pricing for the given route/cargo.',
        details: pricingErr.message,
      });
    }

    let estimatedPrice = null;
    try {
      const trafficMultiplier = await getLiveTrafficMultiplier(pickup_lat, pickup_lng);

      const mlResult = await predictPrice({
        distanceKm: pricing.distanceKm,
        cargoWeightKg: Number(weight_tonnes) * 1000,
        routeOrigin: pickup_address,
        routeDestination: drop_address,
        trafficMultiplier,
      });
      estimatedPrice = mlResult.estimatedPricePaisa;
    } catch (mlErr) {
      logger.warn({ err: mlErr.message }, 'Price prediction unavailable, falling back to base pricing');
    }

    const MAX_ID_RETRIES = ORDER_DISPLAY_ID_MAX_RETRIES;
    let order = null;
    let orderErr = null;
    let orderDisplayId = null;

    for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
      orderDisplayId = generateOrderDisplayId();
      const { data: rpcData, error: rpcErr } = await (supabaseAdmin ?? supabase).rpc('create_order_tx', {
        p_order_display_id: orderDisplayId,
        p_customer_id: userId,
        p_customer_name: user?.fullName || 'Customer',
        p_pickup_address: pickup_address,
        p_pickup_lat: pickup_lat,
        p_pickup_lng: pickup_lng,
        p_drop_address: drop_address,
        p_drop_lat: drop_lat,
        p_drop_lng: drop_lng,
        p_pickup_date: pickup_date,
        p_pickup_time: pickup_time,
        p_goods_type: goods_type,
        p_weight_tonnes: weight_tonnes,
        p_length_ft: length_ft || null,
        p_width_ft: width_ft || null,
        p_height_ft: height_ft || null,
        p_is_stackable: is_stackable,
        p_is_fragile: is_fragile,
        p_special_requirements: special_requirements || null,
        p_base_freight: pricing.baseFreight,
        p_toll_estimate: pricing.tollEstimate,
        p_platform_fee: pricing.platformFee,
        p_total_amount: pricing.totalAmount,
        p_estimated_price: estimatedPrice,
        p_payment_method_id: payment_method_id || null,
        p_upi_id: upi_id || null,
        p_route_label: `${pickup_address.split(',')[0]} → ${drop_address.split(',')[0]}`,
        p_route_subtitle: `${weight_tonnes} tonnes • ${goods_type}`,
        p_weight_text: `${weight_tonnes} tonnes`,
        p_fuel_cost: pricing.fuelCost,
        p_net_profit: pricing.netProfit,
        p_extra_distance_km: pricing.distanceKm,
        p_idempotency_key: idempotencyKey,
        p_request_fingerprint: fingerprint
      });

      if (rpcErr) {
        if (rpcErr.code === '23505') {
          logger.warn(`[Orders] display ID collision on ${orderDisplayId}, retrying (attempt ${attempt + 1}/${MAX_ID_RETRIES})`);
          continue;
        }
        logger.error('Order RPC Insertion Error:', rpcErr.message);
        throw new DomainError(500, { error: 'Failed to create order record via transaction.', details: rpcErr.message });
      }

      order = rpcData;
      orderErr = null;
      break;
    }

    if (!order) {
      throw new DomainError(500, { error: 'Failed to generate a unique order display ID after max retries.' });
    }

    // Durable idempotency discriminator: create_order_tx returns idempotent=true
    // for every path taken while an idempotency key was supplied. All claim →
    // create → complete happened in one DB transaction, so:
    //   - 'created'     → this request won the key; order.response is the order row
    //   - 'replayed'    → a prior run already committed; return its stored response
    //   - 'conflict'    → key reused with a different payload
    //   - 'in_progress' → a concurrent duplicate currently holds the key
    if (order.idempotent === true) {
      if (order.outcome === 'conflict') {
        throw new DomainError(409, { error: 'Idempotency key has already been used for a different request.' });
      }
      if (order.outcome === 'in_progress') {
        throw new DomainError(409, { error: 'Duplicate request being processed' });
      }
      if (order.outcome === 'replayed') {
        return order.response;
      }
      if (order.outcome !== 'created') {
        throw new DomainError(500, { error: `Unexpected idempotency outcome: ${order.outcome}` });
      }
      order = order.response.order;
    }

    try {
      await sendNewTripNotifications({
        pickupLat: Number(pickup_lat),
        pickupLng: Number(pickup_lng),
        weightTonnes: Number(weight_tonnes),
        pickupAddress: pickup_address,
        dropAddress: drop_address,
        orderDisplayId,
      });
    } catch (pushErr) {
      logger.error('Failed to send push notifications to drivers:', pushErr.message);
    }

    return { message: 'Order created successfully and broadcasted to loads board.', order };
  });
}

