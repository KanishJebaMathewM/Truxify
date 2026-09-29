import logger from '../../middleware/logger.js';
import { redisClient, supabaseAdmin } from '../../config/db.js';
import { getRouteEstimate } from '../osrm.js';
import { getLiveTrafficMultiplier } from '../trafficService.js';
import { haversineDistance } from '../utils/coordinates.js';
import { broadcastOrderEta } from '../../sockets/tracker.js';
import { emitEtaUpdateToBooking } from '../../sockets/locationServer.js';

/** Order statuses where live ETA updates are meaningful. */
export const ACTIVE_ETA_STATUSES = [
  'truck_assigned',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'in_transit',
  'arriving',
];

/** Statuses that must never receive ETA updates. */
export const TERMINAL_ETA_STATUSES = ['delivered', 'cancelled', 'payment_released'];

const DEFAULT_LOCATION_MOVEMENT_THRESHOLD_M = 200;
const DEFAULT_ETA_CHANGE_THRESHOLD_SECONDS = 120;

const LOCATION_MOVEMENT_THRESHOLD_M = parsePositiveNumber(
  process.env.ETA_LOCATION_MOVEMENT_THRESHOLD_M,
  DEFAULT_LOCATION_MOVEMENT_THRESHOLD_M,
);
const ETA_CHANGE_THRESHOLD_SECONDS = parsePositiveNumber(
  process.env.ETA_CHANGE_THRESHOLD_SECONDS,
  DEFAULT_ETA_CHANGE_THRESHOLD_SECONDS,
);

const REDIS_LAST_POS_PREFIX = 'driver:eta:last-pos:';
const REDIS_ARRIVAL_EPOCH_PREFIX = 'order:eta:arrival-epoch:';
const REDIS_CALC_TOKEN_PREFIX = 'order:eta:calc-token:';
const REDIS_TTL_SECONDS = 86400;

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Formats an estimated arrival instant as a human-readable ETA string
 * stored in orders.eta (e.g. "Today 4:30 PM", "Tomorrow 9:00 AM").
 */
export function formatEtaDisplay(arrivalDate) {
  if (!(arrivalDate instanceof Date) || Number.isNaN(arrivalDate.getTime())) {
    return null;
  }

  const now = new Date();
  const diffMs = arrivalDate.getTime() - now.getTime();
  if (diffMs <= 0) {
    return 'Arriving soon';
  }

  const isSameDay = arrivalDate.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = arrivalDate.toDateString() === tomorrow.toDateString();
  const timeStr = arrivalDate.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isSameDay) return `Today ${timeStr}`;
  if (isTomorrow) return `Tomorrow ${timeStr}`;
  return arrivalDate.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Resolves the route destination for ETA based on order lifecycle status.
 * Before pickup milestones the driver is routed to pickup; afterwards to drop.
 */
export function resolveDestinationForOrder(order) {
  if (!order) return null;

  const prePickupStatuses = ['truck_assigned', 'en_route_pickup', 'arrived_pickup'];
  const usePickup = prePickupStatuses.includes(order.status);

  const lat = usePickup ? order.pickup_lat : order.drop_lat;
  const lng = usePickup ? order.pickup_lng : order.drop_lng;

  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return null;
  }

  return { lat: Number(lat), lng: Number(lng) };
}

export function isActiveEtaStatus(status) {
  return ACTIVE_ETA_STATUSES.includes(status);
}

export function isTerminalEtaStatus(status) {
  return TERMINAL_ETA_STATUSES.includes(status);
}

/**
 * Computes route-based ETA from origin to destination using OSRM + traffic.
 */
export async function calculateRouteEta({ originLat, originLng, destLat, destLng }) {
  if (
    !Number.isFinite(originLat) || !Number.isFinite(originLng) ||
    !Number.isFinite(destLat) || !Number.isFinite(destLng)
  ) {
    return null;
  }

  try {
    const routeEstimate = await getRouteEstimate({
      pickupLat: originLat,
      pickupLng: originLng,
      dropLat: destLat,
      dropLng: destLng,
    });

    if (!routeEstimate?.durationSeconds || routeEstimate.durationSeconds <= 0) {
      return null;
    }

    const trafficMultiplier = await getLiveTrafficMultiplier(originLat, originLng);
    const adjustedSeconds = routeEstimate.durationSeconds * trafficMultiplier;
    const safeDurationSeconds = Math.max(0, adjustedSeconds);
    const arrivalDate = new Date(Date.now() + safeDurationSeconds * 1000);
    const etaText = formatEtaDisplay(arrivalDate);

    if (!etaText) return null;

    return {
      etaText,
      arrivalEpochMs: arrivalDate.getTime(),
      durationSeconds: safeDurationSeconds,
    };
  } catch (err) {
    logger.warn({ err: err?.message }, '[EtaService] Route ETA calculation failed');
    return null;
  }
}


async function getLastCalcPosition(driverId) {
  if (!redisClient || !driverId) return null;
  try {
    const raw = await redisClient.get(`${REDIS_LAST_POS_PREFIX}${driverId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err: err?.message, driverId }, '[EtaService] Failed to read last calc position');
    return null;
  }
}

async function setLastCalcPosition(driverId, lat, lng) {
  if (!redisClient || !driverId) return;
  try {
    await redisClient.set(
      `${REDIS_LAST_POS_PREFIX}${driverId}`,
      JSON.stringify({ lat, lng }),
      'EX',
      REDIS_TTL_SECONDS,
    );
  } catch (err) {
    logger.warn({ err: err?.message, driverId }, '[EtaService] Failed to store last calc position');
  }
}

async function getLastPersistedArrivalEpoch(orderId) {
  if (!redisClient || !orderId) return null;
  try {
    const raw = await redisClient.get(`${REDIS_ARRIVAL_EPOCH_PREFIX}${orderId}`);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (err) {
    logger.warn({ err: err?.message, orderId }, '[EtaService] Failed to read last arrival epoch');
    return null;
  }
}

async function setLastPersistedArrivalEpoch(orderId, arrivalEpochMs) {
  if (!redisClient || !orderId) return;
  try {
    await redisClient.set(
      `${REDIS_ARRIVAL_EPOCH_PREFIX}${orderId}`,
      String(arrivalEpochMs),
      'EX',
      REDIS_TTL_SECONDS,
    );
  } catch (err) {
    logger.warn({ err: err?.message, orderId }, '[EtaService] Failed to store last arrival epoch');
  }
}

async function acquireCalcToken(orderId) {
  if (!redisClient || !orderId) return Date.now();
  try {
    const token = await redisClient.incr(`${REDIS_CALC_TOKEN_PREFIX}${orderId}`);
    await redisClient.expire(`${REDIS_CALC_TOKEN_PREFIX}${orderId}`, REDIS_TTL_SECONDS);
    return token;
  } catch (err) {
    logger.warn({ err: err?.message, orderId }, '[EtaService] Failed to acquire calc token');
    return Date.now();
  }
}

async function isCalcTokenCurrent(orderId, token) {
  if (!redisClient || !orderId) return true;
  try {
    const current = await redisClient.get(`${REDIS_CALC_TOKEN_PREFIX}${orderId}`);
    return current == null || Number(current) === Number(token);
  } catch (err) {
    logger.warn({ err: err?.message, orderId }, '[EtaService] Failed to verify calc token');
    return true;
  }
}

/**
 * Returns true when the driver has moved far enough to warrant a new routing call.
 */
export function hasMeaningfulMovement(lastPos, lat, lng, thresholdM = LOCATION_MOVEMENT_THRESHOLD_M) {
  if (!lastPos || !Number.isFinite(lastPos.lat) || !Number.isFinite(lastPos.lng)) {
    return true;
  }
  const distanceM = haversineDistance(lastPos.lat, lastPos.lng, lat, lng, 'meters');
  return distanceM >= thresholdM;
}

/**
 * Returns true when the newly calculated arrival differs enough from the last
 * persisted arrival to justify a DB write and realtime broadcast.
 */
export function isMeaningfulEtaChange(lastArrivalEpochMs, newArrivalEpochMs, thresholdSeconds = ETA_CHANGE_THRESHOLD_SECONDS) {
  if (lastArrivalEpochMs == null) return true;
  if (!Number.isFinite(newArrivalEpochMs)) return false;
  const diffSeconds = Math.abs(newArrivalEpochMs - lastArrivalEpochMs) / 1000;
  return diffSeconds >= thresholdSeconds;
}

async function getDriverLocation(driverId) {
  if (!driverId) return null;

  if (redisClient) {
    try {
      const raw = await redisClient.get(`driver:location:${driverId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const lat = parsed.latitude ?? parsed.lat;
        const lng = parsed.longitude ?? parsed.lng;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng };
        }
      }
    } catch (err) {
      logger.warn({ err: err?.message, driverId }, '[EtaService] Redis driver location lookup failed');
    }
  }

  if (!supabaseAdmin) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from('driver_locations')
      .select('latitude, longitude')
      .eq('driver_id', driverId)
      .eq('is_active', true)
      .order('last_updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) return null;
    return { lat: data.latitude, lng: data.longitude };
  } catch (err) {
    logger.warn({ err: err?.message, driverId }, '[EtaService] driver_locations lookup failed');
    return null;
  }
}

function broadcastEtaUpdate(orderDisplayId, eta) {
  if (!orderDisplayId || !eta) return;
  try {
    broadcastOrderEta(orderDisplayId, eta);
  } catch (err) {
    logger.warn({ err: err?.message, orderDisplayId }, '[EtaService] tracker ETA broadcast failed');
  }
  try {
    emitEtaUpdateToBooking(orderDisplayId, eta);
  } catch (err) {
    logger.warn({ err: err?.message, orderDisplayId }, '[EtaService] Socket.IO ETA broadcast failed');
  }
}

/**
 * Persists ETA when meaningful and broadcasts the update. Returns true on success.
 */
export async function persistAndBroadcastEta({
  orderRepository,
  orderId,
  orderDisplayId,
  etaText,
  arrivalEpochMs,
  calcToken,
  currentStatus,
}) {
  if (!orderRepository || !orderId || !etaText) return false;
  if (currentStatus && !isActiveEtaStatus(currentStatus)) return false;

  if (!(await isCalcTokenCurrent(orderId, calcToken))) {
    logger.debug({ orderId }, '[EtaService] Discarding stale ETA calculation');
    return false;
  }

  const lastArrivalEpoch = await getLastPersistedArrivalEpoch(orderId);
  if (!isMeaningfulEtaChange(lastArrivalEpoch, arrivalEpochMs)) {
    return false;
  }

  const { data, error } = await orderRepository.updateOrderWithFilter(
    orderId,
    {
      eta: etaText,
      updated_at: new Date().toISOString(),
    },
    [{ op: 'in', column: 'status', value: ACTIVE_ETA_STATUSES }],
    'id, order_display_id, eta, status',
  );

  if (error || !data) {
    if (error) {
      logger.warn({ err: error.message, orderId }, '[EtaService] Failed to persist ETA');
    }
    return false;
  }

  await setLastPersistedArrivalEpoch(orderId, arrivalEpochMs);
  broadcastEtaUpdate(orderDisplayId || data.order_display_id, etaText);
  return true;
}

/**
 * Calculates and stores the initial ETA after a driver is assigned.
 * Failures are logged and never propagate to the caller.
 */
export async function calculateInitialEtaAfterAssignment({
  orderRepository,
  orderId,
  driverId,
  orderDisplayId,
}) {
  if (!orderRepository || !orderId || !driverId) return;

  try {
    const { data: order, error } = await orderRepository.findOrderById(
      orderId,
      'id, order_display_id, status, driver_id, pickup_lat, pickup_lng, drop_lat, drop_lng',
    );

    if (error || !order) {
      logger.warn({ orderId, err: error?.message }, '[EtaService] Initial ETA: order lookup failed');
      return;
    }

    if (order.driver_id !== driverId) {
      logger.warn({ orderId, driverId }, '[EtaService] Initial ETA: driver mismatch');
      return;
    }

    if (!isActiveEtaStatus(order.status)) {
      return;
    }

    const destination = resolveDestinationForOrder(order);
    if (!destination) {
      logger.warn({ orderId }, '[EtaService] Initial ETA: missing destination coordinates');
      return;
    }

    const driverLocation = await getDriverLocation(driverId);
    if (!driverLocation) {
      logger.info({ orderId, driverId }, '[EtaService] Initial ETA skipped: no driver location yet');
      return;
    }

    const calcToken = await acquireCalcToken(orderId);
    const result = await calculateRouteEta({
      originLat: driverLocation.lat,
      originLng: driverLocation.lng,
      destLat: destination.lat,
      destLng: destination.lng,
    });

    if (!result) {
      logger.warn({ orderId }, '[EtaService] Initial ETA: routing returned no estimate');
      return;
    }

    await persistAndBroadcastEta({
      orderRepository,
      orderId,
      orderDisplayId: orderDisplayId || order.order_display_id,
      etaText: result.etaText,
      arrivalEpochMs: result.arrivalEpochMs,
      calcToken,
      currentStatus: order.status,
    });

    await setLastCalcPosition(driverId, driverLocation.lat, driverLocation.lng);
  } catch (err) {
    logger.error({ err: err?.message, orderId, driverId }, '[EtaService] Initial ETA calculation failed');
  }
}

/**
 * Fire-and-forget hook for driver location updates. Recalculates ETA only when
 * movement and ETA delta thresholds are met for the assigned active order.
 */
export async function maybeRecalculateEtaOnLocationUpdate({
  orderRepository,
  driverId,
  orderId,
  orderDisplayId,
  lat,
  lng,
}) {
  if (!orderRepository || !driverId || !orderId) return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  try {
    const { data: order, error } = await orderRepository.findOrderById(
      orderId,
      'id, order_display_id, status, driver_id, pickup_lat, pickup_lng, drop_lat, drop_lng, eta',
    );

    if (error || !order) return;
    if (order.driver_id !== driverId) return;
    if (!isActiveEtaStatus(order.status)) return;

    const lastPos = await getLastCalcPosition(driverId);
    if (!hasMeaningfulMovement(lastPos, lat, lng)) {
      return;
    }

    const destination = resolveDestinationForOrder(order);
    if (!destination) return;

    const calcToken = await acquireCalcToken(orderId);
    const result = await calculateRouteEta({
      originLat: lat,
      originLng: lng,
      destLat: destination.lat,
      destLng: destination.lng,
    });

    if (!result) return;

    const persisted = await persistAndBroadcastEta({
      orderRepository,
      orderId,
      orderDisplayId: orderDisplayId || order.order_display_id,
      etaText: result.etaText,
      arrivalEpochMs: result.arrivalEpochMs,
      calcToken,
      currentStatus: order.status,
    });

    if (persisted) {
      await setLastCalcPosition(driverId, lat, lng);
    }
  } catch (err) {
    logger.warn({ err: err?.message, orderId, driverId }, '[EtaService] Location ETA recalculation failed');
  }
}

/**
 * Schedules initial ETA calculation without blocking the assignment flow.
 */
export function scheduleInitialEtaAfterAssignment(params) {
  void calculateInitialEtaAfterAssignment(params);
}

/**
 * Schedules live ETA recalculation without blocking location ingestion.
 */
export function scheduleEtaRecalculationOnLocationUpdate(params) {
  void maybeRecalculateEtaOnLocationUpdate(params);
}

export const __testing = {
  LOCATION_MOVEMENT_THRESHOLD_M,
  ETA_CHANGE_THRESHOLD_SECONDS,
  REDIS_LAST_POS_PREFIX,
  REDIS_ARRIVAL_EPOCH_PREFIX,
  REDIS_CALC_TOKEN_PREFIX,
};
