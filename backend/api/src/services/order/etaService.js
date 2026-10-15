import logger from '../../middleware/logger.js';
import { redisClient, supabaseAdmin } from '../../config/db.js';
import { getRouteEstimate } from '../osrm.js';
import { getLiveTrafficMultiplier } from '../trafficService.js';
import { getHaversineDistance } from '../routingService.js';
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

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const km = getHaversineDistance(lat1, lng1, lat2, lng2);
  return km * 1000;
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
export function hasMeaningfulMovement(last
