import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { mongoDb, redisClient, firebaseAdmin, supabase, supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { createLocationEventBus } from './locationEventBus.js';
import telemetryBuffer from './telemetryBuffer.js';
import GpsLog from '../models/GpsLog.js';
import { scheduleEtaRecalculationOnLocationUpdate } from '../services/order/etaService.js';
import DeliveryDelayService from '../services/order/deliveryDelayService.js';
import { calculateAdaptiveInterval, getQueueDepth } from './adaptivePoller.js';

// =====================================================================
// SCHEMA & VALIDATION DEFINITIONS
// =====================================================================
const TELEMETRY_SCHEMA = {
  lat: { type: 'number', required: false, min: -90, max: 90 },
  lng: { type: 'number', required: false, min: -180, max: 180 },
  latitude: { type: 'number', required: false, min: -90, max: 90 },
  longitude: { type: 'number', required: false, min: -180, max: 180 },
  driver_id: { type: 'string', required: false, minLen: 1, maxLen: 64 },
  speed: { type: 'number', required: false, min: 0, max: 200 },
  bearing: { type: 'number', required: false, min: 0, max: 360 },
  device_timestamp: { type: 'string', required: false, maxLen: 64 },
  order_id: { type: 'string', required: false, maxLen: 64 },
  orderId: { type: 'string', required: false, maxLen: 64 },
  order_display_id: { type: 'string', required: false, maxLen: 64 },
};

function validateTelemetryPayload(data) {
  const errors = [];
  const hasLatLng = data.lat !== undefined && data.lat !== null && data.lng !== undefined && data.lng !== null;
  const hasLatLong = data.latitude !== undefined && data.latitude !== null && data.longitude !== undefined && data.longitude !== null;

  if (!hasLatLng && !hasLatLong) {
    errors.push('At least one coordinate pair (lat/lng or latitude/longitude) is required');
  }

  for (const [field, rules] of Object.entries(TELEMETRY_SCHEMA)) {
    const value = data[field];
    if (rules.required && (value === undefined || value === null)) {
      errors.push(`${field} is required`);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (rules.type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) {
      errors.push(`${field} must be a valid number`);
    }
    if (rules.type === 'string' && typeof value !== 'string') {
      errors.push(`${field} must be a string`);
    }
    if (rules.min !== undefined && value < rules.min) errors.push(`${field} must be >= ${rules.min}`);
    if (rules.max !== undefined && value > rules.max) errors.push(`${field} must be <= ${rules.max}`);
    if (rules.minLen !== undefined && String(value).length < rules.minLen) errors.push(`${field} is too short`);
    if (rules.maxLen !== undefined && String(value).length > rules.maxLen) errors.push(`${field} exceeds max length ${rules.maxLen}`);
  }
  return errors.length > 0 ? errors : null;
}

function sanitizeTelemetryData(data) {
  const sanitized = {};
  for (const [field, rules] of Object.entries(TELEMETRY_SCHEMA)) {
    const value = data[field];
    if (value !== undefined && value !== null) {
      sanitized[field] = rules.type === 'number' ? Number(value) : String(value);
    }
  }
  return sanitized;
}

// =====================================================================
// CONFIGURATION & CONSTANTS
// =====================================================================
export const CLOCK_SKEW_TOLERANCE_MS = parseInt(process.env.CLOCK_SKEW_TOLERANCE_MS, 10) || 300000;
const MAX_CONSECUTIVE_DROPS = 10;
const TRACKER_DRIVER_STATE_TTL_MS = parseInt(process.env.TRACKER_DRIVER_STATE_TTL_MS, 10) || 900000;
const DRIVER_STATE_SWEEP_INTERVAL_MS = parseInt(process.env.DRIVER_STATE_SWEEP_INTERVAL_MS, 10) || 60000;
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS, 10) || 180000;

const WS_UPGRADE_RATE_LIMIT = 5;
const WS_UPGRADE_RATE_WINDOW_SECONDS = 60;
const MAX_MSG_PER_SECOND = 10;
const WS_MAX_PAYLOAD_BYTES = parseInt(process.env.WS_MAX_PAYLOAD_BYTES, 10) || 4096;
const WS_AUTH_TIMEOUT_MS = 10000;
const WS_UPGRADE_LIMITS_SWEEP_INTERVAL_MS = 30000;

const GPS_LOG_RETRY_DELAYS_MS = [100, 200, 400];
const GPS_LOG_MAX_RETRIES = 5;
const GPS_LOG_DLQ_KEY = 'gps_log_dlq';

const DRIVER_ORDER_CACHE_TTL_SECONDS = 60;
const DRIVER_ORDER_CACHE_KEY_PREFIX = 'driver:active-order:';

const TRACKER_CHANNELS = {
  LOCATION: 'tracker:location_updates',
  MILESTONE: 'tracker:milestone_updates',
  ETA: 'tracker:eta_updates',
};

// =====================================================================
// STATE MANAGEMENT & CACHES
// =====================================================================
let _orderRepository = null;
let _deliveryDelayService = null;
let trackingSubscriptions = new Map();
let redisSubClient = null;
const locationChannels = new Map();
const displayIdToLocationChannelKeys = new Map();
const driverToLocationChannels = new Map();
let locationEventBus = null;

const consecutiveDropCount = new Map();
let lastDriverStateSweep = 0;

let isSchedulerActive = false;
let telemetryFlushTimeout = null;
let wsServer = null;
let wsHeartbeatInterval = null;
let telemetryMonitorInterval = null;
let driverStateSweepInterval = null;
let wsUpgradeLimitsCleanupInterval = null;
let messageRateTrackerCleanupInterval = null;

const messageRateTracker = new Map();
const wsUpgradeMemoryLimits = new Map();

// =====================================================================
// HELPER & UTILITY FUNCTIONS
// =====================================================================
function sweepStaleDriverState(now) {
  if (now - lastDriverStateSweep < DRIVER_STATE_SWEEP_INTERVAL_MS) return;
  lastDriverStateSweep = now;
  for (const [driverId, entry] of consecutiveDropCount) {
    if (now - entry.lastUpdated > TRACKER_DRIVER_STATE_TTL_MS) {
      consecutiveDropCount.delete(driverId);
    }
  }
}

async function getCachedDriverOrder(driverId) {
  if (!driverId || !redisClient) return null;
  try {
    const cached = await redisClient.get(`${DRIVER_ORDER_CACHE_KEY_PREFIX}${driverId}`);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    logger.error({ err, driverId }, 'Redis driver order cache get error');
    return null;
  }
}

async function setCachedDriverOrder(driverId, orderId, orderDisplayId) {
  if (!driverId || !redisClient || !orderId) return;
  try {
    await redisClient.set(
      `${DRIVER_ORDER_CACHE_KEY_PREFIX}${driverId}`,
      JSON.stringify({ orderId, orderDisplayId }),
      'EX',
      DRIVER_ORDER_CACHE_TTL_SECONDS
    );
  } catch (err) {
    logger.error({ err, driverId }, 'Redis driver order cache set error');
  }
}

async function invalidateDriverOrderCache(driverId) {
  if (!driverId || !redisClient) return;
  try {
    await redisClient.del(`${DRIVER_ORDER_CACHE_KEY_PREFIX}${driverId}`);
  } catch (err) {
    logger.error({ err, driverId }, 'Redis driver order cache invalidate error');
  }
}

export function getClientIp(request) {
  return request.socket?.remoteAddress || request.connection?.remoteAddress || 'unknown';
}

function enforceWsUpgradeMemoryLimit(ipAddress) {
  const now = Date.now();
  const windowMs = WS_UPGRADE_RATE_WINDOW_SECONDS * 1000;
  let entry = wsUpgradeMemoryLimits.get(ipAddress);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    wsUpgradeMemoryLimits.set(ipAddress, entry);
  }
  entry.count++;
  if (wsUpgradeMemoryLimits.size > 10000) {
    for (const [key, e] of wsUpgradeMemoryLimits) {
      if (now >= e.resetAt) wsUpgradeMemoryLimits.delete(key);
    }
  }
  return entry.count <= WS_UPGRADE_RATE_LIMIT;
}

function sweepWsUpgradeMemoryLimits() {
  const now = Date.now();
  for (const [key, e] of wsUpgradeMemoryLimits) {
    if (now >= e.resetAt) wsUpgradeMemoryLimits.delete(key);
  }
}

export async function isWebSocketUpgradeAllowed(request) {
  const ipAddress = getClientIp(request);
  const key = `ws:upgrade:${ipAddress}`;

  if (!redisClient) {
    return enforceWsUpgradeMemoryLimit(ipAddress);
  }

  try {
    const attempts = await redisClient.incr(key);
    if (attempts === 1 || (await redisClient.ttl(key)) === -1) {
      await redisClient.expire(key, WS_UPGRADE_RATE_WINDOW_SECONDS);
    }
    return attempts <= WS_UPGRADE_RATE_LIMIT;
  } catch (err) {
    logger.error({ err }, 'Redis WebSocket upgrade rate limit error');
    return enforceWsUpgradeMemoryLimit(ipAddress);
  }
}

export function rejectWebSocketUpgrade(socket) {
  socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

export function rejectConnectionWithTokenInUrl(ws, reqUrl) {
  const urlToken = reqUrl.searchParams.get('token');
  if (!urlToken) return false;
  logger.warn({ event: 'WS_TOKEN_IN_URL' }, 'WebSocket auth token present in URL query string; refusing connection');
  ws.send(JSON.stringify({
    error: 'Unauthorized: auth token must not be sent in the URL query string',
    code: 4001,
  }));
  ws.close(4001, 'Auth token must not be sent in the URL query string');
  return true;
}

// =====================================================================
// PUB/SUB & BROADCAST MANAGEMENT
// =====================================================================
function deliverToLocalSubscribers(targetId, payload) {
  if (!targetId || !trackingSubscriptions.has(targetId)) return;
  const clients = trackingSubscriptions.get(targetId);
  clients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
}

function initRedisTrackerPubSub() {
  if (!redisClient || redisSubClient) return;

  try {
    redisSubClient = redisClient.duplicate();
    redisSubClient.subscribe(TRACKER_CHANNELS.LOCATION, TRACKER_CHANNELS.MILESTONE, TRACKER_CHANNELS.ETA, (err) => {
      if (err) {
        logger.error({ err }, '[Tracker] Failed to subscribe to Redis tracker channels');
      } else {
        logger.info('[Tracker] Subscribed to Redis Pub/Sub tracker channels for multi-replica broadcasting');
      }
    });

    redisSubClient.on('message', (channel, message) => {
      try {
        const parsed = JSON.parse(message);
        if (channel === TRACKER_CHANNELS.LOCATION) {
          const { orderDisplayId, driver_id, payload } = parsed;
          if (orderDisplayId) deliverToLocalSubscribers(orderDisplayId, payload);
          if (driver_id) deliverToLocalSubscribers(driver_id, payload);
        } else if (channel === TRACKER_CHANNELS.MILESTONE || channel === TRACKER_CHANNELS.ETA) {
          const { orderDisplayId, payload } = parsed;
          if (orderDisplayId) deliverToLocalSubscribers(orderDisplayId, payload);
        }
      } catch (err) {
        logger.error({ err }, '[Tracker] Error handling Pub/Sub message');
      }
    });
  } catch (err) {
    logger.error({ err }, '[Tracker] Redis Pub/Sub initialization error');
  }
}

function buildClientLocationPayload({ driverId, orderDisplayId, lat, lng, speed, bearing, timestampIso }) {
  return JSON.stringify({
    event: 'location_update',
    data: {
      driver_id: driverId,
      order_display_id: orderDisplayId,
      latitude: lat,
      longitude: lng,
      speed,
      bearing,
      timestamp: timestampIso,
    },
  });
}

function buildClientPayloadFromInternalEvent(event) {
  return buildClientLocationPayload({
    driverId: event.driverId,
    orderDisplayId: event.orderDisplayId,
    lat: event.location.lat,
    lng: event.location.lng,
    speed: event.location.speed,
    bearing: event.location.bearing,
    timestampIso: event.timestamp,
  });
}

function deliverLocationToLocalSubscribers(subscriptionMap, payload, orderDisplayId, driverId, metricsBus) {
  const bus = metricsBus || locationEventBus;
  const deliveredSockets = new Set();
  let delivered = 0;

  const targets = [orderDisplayId, driverId].filter(Boolean);
  for (const target of targets) {
    if (subscriptionMap.has(target)) {
      for (const client of subscriptionMap.get(target)) {
        if (client.readyState === 1 && !deliveredSockets.has(client)) {
          deliveredSockets.add(client);
          client.send(payload);
          delivered++;
        }
      }
    }
  }

  bus?.recordDelivery(delivered);
  return delivered;
}

function createLocationEventHandler(targetBus, subscriptionMap) {
  return (event) => {
    const bus = targetBus || locationEventBus;
    if (!bus || event.sourceInstanceId === bus.getInstanceId()) return;

    const payload = buildClientPayloadFromInternalEvent(event);
    const map = subscriptionMap || trackingSubscriptions;
    const delivered = deliverLocationToLocalSubscribers(map, payload, event.orderDisplayId, event.driverId, bus);
    if (delivered === 0) {
      bus.recordNoSubscribers();
    }
  };
}

// =====================================================================
// AUTHENTICATION & MESSAGING
// =====================================================================
async function authenticateWs(ws, token) {
  if (!token) {
    ws.send(JSON.stringify({ error: 'Unauthorized: No token provided', code: 4001 }));
    ws.close(4001, 'Unauthorized: No token provided');
    return;
  }

  try {
    let decoded = null;
    try {
      decoded = jwt.decode(token);
    } catch (err) {
      logger.warn({ err: err?.message || err }, '[Tracker] Failed to decode JWT token structure');
    }

    const isSupabaseToken = decoded && typeof decoded === 'object' && typeof decoded.iss === 'string' && decoded.iss.includes('supabase');
    let profile = null;

    if (isSupabaseToken) {
      if (!supabase) {
        ws.send(JSON.stringify({ error: 'Unauthorized: Supabase client is not configured', code: 4001 }));
        ws.close(4001, 'Unauthorized: Supabase client is not configured');
        return;
      }
      const response = await supabase.auth.getUser(token);
      const user = response?.data?.user;
      if (response?.error || !user) {
        ws.send(JSON.stringify({ error: 'Unauthorized: Invalid or expired Supabase token', code: 4001 }));
        ws.close(4001, 'Unauthorized: Invalid or expired Supabase token');
        return;
      }

      const { data: userProfile, error } = await supabase
        .from('profiles')
        .select('id, firebase_uid, role')
        .eq('id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (error || !userProfile) {
        ws.send(JSON.stringify({ error: 'Unauthorized: User profile not found', code: 4001 }));
        ws.close(4001, 'Unauthorized: User profile not found');
        return;
      }
      profile = userProfile;
    } else {
      if (!firebaseAdmin) {
        ws.send(JSON.stringify({ error: 'Unauthorized: Firebase Auth is not configured', code: 4001 }));
        ws.close(4001, 'Unauthorized: Firebase Auth is not configured');
        return;
      }
      const decodedToken = await firebaseAdmin.auth().verifyIdToken(token, true);
      if (!supabase) {
        ws.send(JSON.stringify({ error: 'Unauthorized: Profile lookup is not configured', code: 4001 }));
        ws.close(4001, 'Unauthorized: Profile lookup is not configured');
        return;
      }

      const { data: userProfile, error } = await supabase
        .from('profiles')
        .select('id, firebase_uid, role')
        .eq('firebase_uid', decodedToken.uid)
        .eq('is_active', true)
        .maybeSingle();

      if (error || !userProfile) {
        ws.send(JSON.stringify({ error: 'Unauthorized: User profile not found', code: 4001 }));
        ws.close(4001, 'Unauthorized: User profile not found');
        return;
      }
      profile = userProfile;
    }

    ws.user = { id: profile.id, uid: profile.firebase_uid, role: profile.role };
    if (profile.role === 'driver') ws.driverId = profile.id;
    ws.authenticated = true;
    await restoreSubscriptions(ws);
    logger.info({ userId: ws.user.id }, 'WS Authenticated user');
  } catch (err) {
    logger.error({ err }, 'WS Auth failed');
    ws.send(JSON.stringify({ error: 'Unauthorized: Invalid token', code: 4001 }));
    ws.close(4001, 'Unauthorized: Invalid token');
  }
}

function isMessageRateLimitedInMemory(ws) {
  const now = Date.now();
  const id = ws.socketId || ws;
  let state = messageRateTracker.get(id);
  if (!state || now - state.windowStart >= 1000) {
    state = { count: 0, windowStart: now };
    messageRateTracker.set(id, state);
  }
  state.count++;
  return state.count > MAX_MSG_PER_SECOND;
}

function sweepMessageRateTracker() {
  const now = Date.now();
  for (const [id, state] of messageRateTracker) {
    if (now - state.windowStart > 1000) {
      messageRateTracker.delete(id);
    }
  }
}

export async function isMessageRateLimited(ws) {
  if (redisClient && redisClient.status === 'ready') {
    try {
      const bucket = Math.floor(Date.now() / 1000);
      const key = `ws:msg:${ws.socketId || ws.driverId || 'anon'}:${bucket}`;
      const count = await redisClient.incr(key);
      if (count === 1) await redisClient.expire(key, 2);
      return count > MAX_MSG_PER_SECOND;
    } catch (err) {
      logger.warn('Redis WS message rate limit failed, falling back to in-memory:', err.message);
    }
  }
  return isMessageRateLimitedInMemory(ws);
}

export async function handleTrackingMessage(ws, message, req) {
  if (await isMessageRateLimited(ws)) {
    return ws.send(JSON.stringify({ error: 'Rate limit exceeded: too many messages per second', code: 429, retryAfter: 1 }));
  }

  const messageText = message.toString();
  if (messageText === 'ping') {
    ws.isAlive = true;
    return ws.send('pong');
  }

  try {
    const payload = JSON.parse(messageText);
    const { event, data } = payload;

    if (!event || !data) {
      return ws.send(JSON.stringify({ error: 'Invalid payload format. Must include "event" and "data" keys.' }));
    }

    if (ws.isAuthenticating) {
      ws.pendingAuthQueue ??= [];
      if (ws.pendingAuthQueue.length < 50) {
        ws.pendingAuthQueue.push({ message, req });
      } else {
        ws.send(JSON.stringify({ error: 'Queue limit exceeded during authentication', code: 4008 }));
        ws.close(4008, 'Queue limit exceeded during authentication');
      }
      return;
    }

    if (ws.authenticated === false) {
      if (event === 'auth') {
        ws.isAuthenticating = true;
        try {
          await authenticateWs(ws, data.token);
          if (ws.authenticated) {
            ws.send(JSON.stringify({ status: 'authenticated', user_id: ws.user?.id ?? ws.driverId }));
            logger.info('New WebSocket connection established on /ws/tracking (first-frame auth)');

            const queue = ws.pendingAuthQueue || [];
            ws.pendingAuthQueue = [];
            ws.isAuthenticating = false;

            for (const item of queue) {
              if (ws.readyState === 1 && ws.authenticated) {
                await handleTrackingMessage(ws, item.message, item.req);
              }
            }
          } else {
            ws.pendingAuthQueue = [];
            ws.isAuthenticating = false;
          }
        } catch (err) {
          ws.pendingAuthQueue = [];
          ws.isAuthenticating = false;
          throw err;
        }
        return;
      }
      ws.send(JSON.stringify({ error: 'Unauthorized: Authenticate first', code: 4001 }));
      ws.close(4001, 'Unauthorized: Authenticate first');
      return;
    }

    switch (event) {
      case 'location_ping':
        await handleLocationPing(ws, data, req);
        break;
      case 'subscribe_tracking':
        await handleSubscribe(ws, data);
        break;
      case 'unsubscribe_tracking':
        await handleUnsubscribe(ws, data);
        break;
      default:
        ws.send(JSON.stringify({ warning: `Unknown event type: ${event}` }));
    }
  } catch (err) {
    logger.error({ err }, 'WS Message parsing error');
    ws.send(JSON.stringify({ error: 'Invalid JSON payload structure.' }));
  }
}

// =====================================================================
// DLQ & GPS LOG RETRY LOGIC
// =====================================================================
async function enqueueGpsLogDlq(doc) {
  if (redisClient && redisClient.status === 'ready') {
    try {
      await redisClient.rpush(GPS_LOG_DLQ_KEY, JSON.stringify({ doc, retries: 0 }));
      return;
    } catch (err) {
      logger.error({ err }, '[GpsLog] Failed to enqueue GPS log to Redis DLQ');
    }
  }
  logger.error('[GpsLog] Redis unavailable — GPS log permanently lost:', JSON.stringify(doc));
}

async function persistGpsLogWithRetry(doc) {
  for (let attempt = 0; attempt < GPS_LOG_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await GpsLog.create(doc);
      return true;
    } catch (err) {
      logger.warn({ err, attempt: attempt + 1 }, `[GpsLog] Write attempt ${attempt + 1} failed`);
      await new Promise((resolve) => setTimeout(resolve, GPS_LOG_RETRY_DELAYS_MS[attempt]));
    }
  }
  logger.error('[GpsLog] All write attempts failed; routing document to dead-letter queue');
  await enqueueGpsLogDlq(doc);
  return false;
}

async function reconcileGpsLogDlqEntry(raw) {
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch (err) {
    logger.error({ err }, '[GpsLog] Dropping malformed DLQ entry');
    return true;
  }

  const { doc, retries = 0 } = entry;

  try {
    await GpsLog.create(doc);
    return true;
  } catch (err) {
    logger.warn({ err }, '[GpsLog] DLQ re-attempt failed');
    if (retries >= GPS_LOG_MAX_RETRIES) {
      logger.error('[GpsLog] DLQ entry exceeded max retries; dropping permanently:', JSON.stringify(doc));
      return true;
    }

    if (redisClient && redisClient.status === 'ready') {
      try {
        await redisClient.rpush(GPS_LOG_DLQ_KEY, JSON.stringify({ doc, retries: retries + 1 }));
        return true;
      } catch (redisErr) {
        logger.error({ err: redisErr }, '[GpsLog] Failed to re-enqueue DLQ entry');
        return false;
      }
    }
    return false;
  }
}

async function reconcileGpsLogDlq() {
  if (!redisClient || redisClient.status !== 'ready') return;
  try {
    while (true) {
      const raw = await redisClient.lpop(GPS_LOG_DLQ_KEY);
      if (!raw) break;
      const shouldRemove = await reconcileGpsLogDlqEntry(raw);
      if (!shouldRemove) {
        await redisClient.rpush(GPS_LOG_DLQ_KEY, raw);
        break;
      }
    }
  } catch (err) {
    logger.error({ err }, '[GpsLog] DLQ reconciliation error');
  }
}

// =====================================================================
// LOCATION PING PROCESSING
// =====================================================================
export async function handleLocationPing(ws, data, req) {
  const driver_id = ws.driverId;

  if (!driver_id || ws.user?.role !== 'driver') {
    return ws.send(JSON.stringify({ error: 'Forbidden: Driver role required to publish location updates', code: 4003 }));
  }

  const { driver_id: payloadDriverId, speed, bearing, device_timestamp } = data;

  if (payloadDriverId && payloadDriverId !== driver_id) {
    const clientIp = req ? getClientIp(req) : 'unknown';
    logger.error({
      event: 'SPOOFED_LOCATION_ATTEMPT',
      authenticatedDriver: driver_id,
      attemptedDriver: payloadDriverId,
      ip: clientIp,
      timestamp: new Date().toISOString(),
    }, 'Location spoofing attempt detected: Driver ID mismatch');

    if (typeof ws.close === 'function') {
      ws.send(JSON.stringify({ error: 'Spoofed location detected: Driver ID mismatch', code: 4010 }));
      ws.close(4010, 'Spoofed location detected: Driver ID mismatch');
    }
    return;
  }

  if (!payloadDriverId) {
    data.driver_id = driver_id;
  }

  const lat = data.lat !== undefined ? data.lat : data.latitude;
  const lng = data.lng !== undefined ? data.lng : data.longitude;

  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return ws.send(JSON.stringify({ error: 'Invalid telemetry payload.', details: ['lat and lng are required'] }));
  }

  data.lat = lat;
  data.lng = lng;

  const normalizedForValidation = {
    lat,
    lng,
    driverId: driver_id,
    timestamp: device_timestamp ? Date.parse(device_timestamp) || Date.now() : Date.now(),
    speed: typeof speed === 'number' ? speed : undefined,
    bearing: typeof bearing === 'number' ? bearing : undefined,
  };

  const normalizedValidationErrors = validateTelemetryPayload(normalizedForValidation);
  if (normalizedValidationErrors) {
    return ws.send(JSON.stringify({ error: 'Invalid telemetry payload.', details: normalizedValidationErrors }));
  }

  const sanitized = sanitizeTelemetryData(data);
  Object.assign(data, sanitized);

  let deviceTime = null;
  if (device_timestamp) {
    const parsedEpoch = Date.parse(device_timestamp);
    if (!Number.isFinite(parsedEpoch)) {
      logger.error(`[TRUXIFY VALIDATION ERROR] Malformed device_timestamp received from driver: ${driver_id}. Falling back to server time.`);
    } else {
      deviceTime = new Date(parsedEpoch);
    }
  }

  const skewCheckTime = deviceTime || new Date();
  const skewMs = Math.abs(skewCheckTime.getTime() - Date.now());
  if (skewMs > CLOCK_SKEW_TOLERANCE_MS) {
    logger.warn(`[TRUXIFY CLOCK SKEW] Driver ${driver_id} clock skew ${skewMs}ms exceeds tolerance ${CLOCK_SKEW_TOLERANCE_MS}ms — ignoring update.`);
    return;
  }

  const serverNow = Date.now();

  if (redisClient) {
    try {
      const seqKey = `driver:sequence:${driver_id}`;
      const lastRecordedEpochStr = await redisClient.get(seqKey);
      const lastRecordedEpoch = Number.parseInt(lastRecordedEpochStr, 10);
      const orderKey = deviceTime ? deviceTime.getTime() : serverNow;

      if (!Number.isNaN(lastRecordedEpoch) && orderKey < lastRecordedEpoch) {
        logger.warn(`[TRUXIFY SEQUENCE CONTROL] Out-of-order telemetry dropped for Driver: ${driver_id}. Stale jitter detected.`);

        const prevEntry = consecutiveDropCount.get(driver_id);
        const currentCount = (prevEntry ? prevEntry.count : 0) + 1;
        consecutiveDropCount.set(driver_id, { count: currentCount, lastUpdated: serverNow });
        sweepStaleDriverState(serverNow);

        if (currentCount >= MAX_CONSECUTIVE_DROPS) {
          logger.warn(`[TRUXIFY CIRCUIT BREAKER] Driver ${driver_id} exceeded max consecutive drops (${MAX_CONSECUTIVE_DROPS}). Resetting sequence.`);
          await redisClient.del(seqKey);
          consecutiveDropCount.delete(driver_id);
        }
        return;
      }

      consecutiveDropCount.delete(driver_id);
      const nextSequence = Number.isNaN(lastRecordedEpoch) || orderKey > lastRecordedEpoch ? orderKey : lastRecordedEpoch + 1;
      await redisClient.set(seqKey, nextSequence.toString(), 'EX', 86400);
    } catch (err) {
      logger.error({ err }, 'Redis sequence verification cache error');
    }
  }

  let orderUUID = data.orderId || data.order_id || null;
  let orderDisplayId = data.order_display_id || null;

  if (_orderRepository && (orderUUID || orderDisplayId)) {
    try {
      const idToLookup = orderUUID || orderDisplayId;
      let verifiedOrder = null;

      const cached = await getCachedDriverOrder(driver_id);
      if (cached && (cached.orderId === idToLookup || cached.orderDisplayId === idToLookup)) {
        orderUUID = cached.orderId;
        orderDisplayId = cached.orderDisplayId;
        const { data: freshOrder } = await _orderRepository.findOrderByAnyId(orderUUID, 'id, order_display_id, driver_id');
        verifiedOrder = freshOrder;
      }

      if (!verifiedOrder) {
        const { data: foundOrder } = await _orderRepository.findOrderByAnyId(idToLookup, 'id, order_display_id, driver_id');
        verifiedOrder = foundOrder;
      }

      if (!verifiedOrder) {
        logger.warn({ event: 'UNRESOLVABLE_ORDER_TRACKING', driver_id, idToLookup }, 'Location ping rejected: unable to resolve order');
        await invalidateDriverOrderCache(driver_id);
        return ws.send(JSON.stringify({ error: 'Order not found or unresolvable', orderId: idToLookup }));
      }

      if (verifiedOrder.driver_id !== driver_id) {
        logger.warn({
          event: 'UNAUTHORIZED_ORDER_TRACKING',
          driver_id,
          orderId: verifiedOrder.id,
          orderDisplayId: verifiedOrder.order_display_id,
          assignedDriverId: verifiedOrder.driver_id,
        }, 'Driver attempted to submit location for order they are not assigned to');
        await invalidateDriverOrderCache(driver_id);
        return ws.send(JSON.stringify({
          error: 'Not authorized to track this order',
          orderId: verifiedOrder.order_display_id || verifiedOrder.id,
        }));
      }

      orderUUID = verifiedOrder.id;
      orderDisplayId = verifiedOrder.order_display_id;
      await setCachedDriverOrder(driver_id, orderUUID, orderDisplayId);
    } catch (err) {
      logger.error({ err }, 'Failed to resolve order details in tracker');
    }
  }

  if (_deliveryDelayService && orderUUID) {
    void _deliveryDelayService.processLocation({
      orderId: orderUUID,
      driverId: driver_id,
      latitude: sanitized.lat,
      longitude: sanitized.lng,
    }).catch((err) => {
      logger.warn({ err, orderId: orderUUID, driverId: driver_id }, '[Tracker] Delivery ETA update failed');
    });
  }

  telemetryBuffer.enqueue({
    driver_id,
    order_id: orderUUID || null,
    order_display_id: orderDisplayId || null,
    lat: sanitized.lat,
    lng: sanitized.lng,
    location: { type: 'Point', coordinates: [sanitized.lng, sanitized.lat] },
    speed_kmh: sanitized.speed ?? 0,
    bearing_deg: sanitized.bearing ?? 0,
    timestamp: deviceTime || new Date(),
    pinged_at: deviceTime || new Date(),
    buffered_at: new Date(),
    server_received_at: new Date(serverNow),
  });

  if (redisClient) {
    try {
      await redisClient.set(
        `driver:location:${driver_id}`,
        JSON.stringify({ latitude: sanitized.lat, longitude: sanitized.lng, speed: sanitized.speed ?? 0, bearing: sanitized.bearing ?? 0, updated_at: new Date(serverNow) }),
        'EX',
        120
      );
    } catch (err) {
      logger.error({ err }, 'Redis cache telemetry error');
    }
  }

  if (supabaseAdmin) {
    void (async () => {
      try {
        await supabaseAdmin.from('driver_locations').update({ is_active: false }).eq('driver_id', driver_id).eq('is_active', true);
        const { error } = await supabaseAdmin.from('driver_locations').insert({
          driver_id,
          latitude: lat,
          longitude: lng,
          is_active: true,
          last_updated_at: new Date(serverNow).toISOString(),
        });
        if (error) logger.error({ error, driver_id }, '[Tracker] Failed to write driver location');
      } catch (err) {
        logger.error({ err, driver_id }, '[Tracker] Failed to write driver location');
      }
    })();
  }

  const timestampIso = new Date(serverNow).toISOString();
  const broadcastPayload = buildClientLocationPayload({
    driverId: driver_id,
    orderDisplayId: orderDisplayId ?? null,
    lat: sanitized.lat,
    lng: sanitized.lng,
    speed: sanitized.speed ?? 0,
    bearing: sanitized.bearing ?? 0,
    timestampIso,
  });

  if (locationEventBus) {
    void locationEventBus.publish({
      type: 'location_update',
      v: 1,
      sourceInstanceId: locationEventBus.getInstanceId(),
      driverId: driver_id,
      orderDisplayId: orderDisplayId ?? null,
      sequence: serverNow,
      timestamp: timestampIso,
      location: { lat: sanitized.lat, lng: sanitized.lng, speed: sanitized.speed ?? 0, bearing: sanitized.bearing ?? 0 },
    });
  }

  deliverLocationToLocalSubscribers(trackingSubscriptions, broadcastPayload, orderDisplayId ?? null, driver_id);

  if (_orderRepository && orderUUID) {
    scheduleEtaRecalculationOnLocationUpdate({
      orderRepository: _orderRepository,
      driverId: driver_id,
      orderId: orderUUID,
      orderDisplayId: orderDisplayId ?? null,
      lat: sanitized.lat,
      lng: sanitized.lng,
    });
  }

  if (supabase && orderUUID) {
    let reconnectAttempts = 0;
    const connectChannel = () => {
      if (!locationChannels.has(orderUUID)) {
        const channel = supabase.channel(`driver-location:${orderUUID}`);
        channel.subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            reconnectAttempts++;
            const backoffMs = reconnectAttempts * 1000;
            logger.warn({ orderUUID, reconnectAttempts, backoffMs }, 'Supabase Realtime channel error. Retrying connection with exponential backoff.');
            locationChannels.delete(orderUUID);
            setTimeout(connectChannel, backoffMs);
          } else if (status === 'SUBSCRIBED') {
            reconnectAttempts = 0;
          }
        });
        locationChannels.set(orderUUID, channel);

        if (driver_id) {
          if (!driverToLocationChannels.has(driver_id)) driverToLocationChannels.set(driver_id, new Set());
          driverToLocationChannels.get(driver_id).add(orderUUID);
        }
        if (orderDisplayId) {
          if (!displayIdToLocationChannelKeys.has(orderDisplayId)) displayIdToLocationChannelKeys.set(orderDisplayId, new Set());
          displayIdToLocationChannelKeys.get(orderDisplayId).add(orderUUID);
        }
      }
    };

    connectChannel();
    const channel = locationChannels.get(orderUUID);
    channel.send({
      type: 'broadcast',
      event: 'location',
      payload: { orderId: orderUUID, driverId: driver_id, lat: sanitized.lat, lng: sanitized.lng, timestamp: new Date(serverNow).toISOString() }
    }).catch((err) => {
      logger.error({ err }, 'Failed to broadcast realtime location to Supabase');
    });
  }
}

// =====================================================================
// SERVER INITIALIZATION & TEARDOWN
// =====================================================================
export function initWebSocketServer(server, orderRepository) {
  if (wsServer) {
    logger.warn('[initWebSocketServer] Already initialized — skipping duplicate call.');
    return;
  }

  _orderRepository = orderRepository;
  _deliveryDelayService = orderRepository ? new DeliveryDelayService({ orderRepository }) : null;
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });
  wsServer = wss;

  if (!locationEventBus) {
    locationEventBus = createLocationEventBus();
    locationEventBus.init(redisClient);
    locationEventBus.subscribe(createLocationEventHandler());
  }

  server.on('upgrade', async (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/ws/tracking') {
      if (!(await isWebSocketUpgradeAllowed(request))) {
        rejectWebSocketUpgrade(socket);
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws, req) => {
    ws._request = req;
    ws.socketId = ws.socketId || crypto.randomUUID();
    const reqUrl = new URL(req.url, 'http://localhost');
    const bypassAuth = process.env.BYPASS_AUTH === 'true';

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (message) => handleTrackingMessage(ws, message, req));
    ws.on('close', () => {
      logger.info('WebSocket connection closed');
      ws.pendingAuthQueue = [];
      ws.isAuthenticating = false;
      void (async () => {
        await removeClientFromAllSubscriptions(ws);
        if (ws.driverId) await removeDriverLocationChannels(ws.driverId);
      })();
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket client error');
      void (async () => {
        await removeClientFromAllSubscriptions(ws);
        if (ws.driverId) await removeDriverLocationChannels(ws.driverId);
      })();
    });

    if (rejectConnectionWithTokenInUrl(ws, reqUrl)) return;

    if (bypassAuth) {
      if (process.env.NODE_ENV === 'production') {
        ws.send(JSON.stringify({ error: 'BYPASS_AUTH is not allowed in production', code: 4003 }));
        return ws.close(4003, 'BYPASS_AUTH is not allowed in production');
      }
      const devToken = reqUrl.searchParams.get('dev_access_token');
      if (!devToken || devToken !== process.env.DEV_ACCESS_TOKEN) {
        ws.send(JSON.stringify({ error: 'Unauthorized: Missing or invalid dev_access_token', code: 4001 }));
        return ws.close(4001, 'Unauthorized: Missing or invalid dev_access_token');
      }
      ws.driverId = reqUrl.searchParams.get('driver_id') || 'test_driver';
      ws.user = { id: reqUrl.searchParams.get('user_id') || ws.driverId, role: reqUrl.searchParams.get('user_role') || 'driver' };
      ws.authenticated = true;
      logger.warn({ event: 'WS_BYPASS_AUTH_USED', driverId: ws.driverId, role: ws.user.role }, 'WS Auth bypassed via DEV_ACCESS_TOKEN');
      return;
    }

    ws.authenticated = false;
    ws.isAuthenticating = false;
    ws.pendingAuthQueue = [];
    const authTimeout = setTimeout(() => {
      if (ws.authenticated === false) {
        ws.send(JSON.stringify({ error: 'Unauthorized: Authentication timeout', code: 4001 }));
        ws.close(4001, 'Unauthorized: Authentication timeout');
      }
    }, WS_AUTH_TIMEOUT_MS);
    ws.once('close', () => clearTimeout(authTimeout));
  });

  wsHeartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    if (wsHeartbeatInterval) { clearInterval(wsHeartbeatInterval); wsHeartbeatInterval = null; }
    if (messageRateTrackerCleanupInterval) { clearInterval(messageRateTrackerCleanupInterval); messageRateTrackerCleanupInterval = null; }
  });

  messageRateTrackerCleanupInterval = setInterval(sweepMessageRateTracker, 30000);
  wsUpgradeLimitsCleanupInterval = setInterval(sweepWsUpgradeMemoryLimits, WS_UPGRADE_LIMITS_SWEEP_INTERVAL_MS);
  driverStateSweepInterval = setInterval(() => sweepStaleDriverState(Date.now()), DRIVER_STATE_SWEEP_INTERVAL_MS);

  if (!isSchedulerActive) telemetryBuffer.start();
  logger.info('🚀 WebSocket tracking router initialized.');
}

export async function closeWebSocketServer() {
  if (telemetryFlushTimeout) { clearTimeout(telemetryFlushTimeout); telemetryFlushTimeout = null; isSchedulerActive = false; }
  if (telemetryMonitorInterval) { clearInterval(telemetryMonitorInterval); telemetryMonitorInterval = null; }
  if (wsHeartbeatInterval) { clearInterval(wsHeartbeatInterval); wsHeartbeatInterval = null; }

  await telemetryBuffer.shutdown();
  if (wsUpgradeLimitsCleanupInterval) { clearInterval(wsUpgradeLimitsCleanupInterval); wsUpgradeLimitsCleanupInterval = null; }
  if (driverStateSweepInterval) { clearInterval(driverStateSweepInterval); driverStateSweepInterval = null; }

  if (locationEventBus) {
    await locationEventBus.close();
    locationEventBus = null;
  }

  if (!wsServer) return;
  const serverToClose = wsServer;
  wsServer = null;

  await new Promise((resolve) => {
    serverToClose.clients?.forEach((client) => {
      try { client.close(1001, 'Server shutting down'); } catch (err) { logger.error({ err }, '[shutdown] Failed to close WebSocket client'); }
    });
    serverToClose.close((err) => {
      if (err) logger.error('[shutdown] WebSocket server close error:', err.message);
      resolve();
    });
  });
}

// =====================================================================
// MILESTONE & ETA PUBLISHING
// =====================================================================
export function broadcastOrderMilestone(orderDisplayId, milestone, status) {
  if (!orderDisplayId) return;
  const payload = JSON.stringify({
    event: 'milestone_update',
    data: { order_display_id: orderDisplayId, milestone, status, timestamp: new Date().toISOString() },
  });

  initRedisTrackerPubSub();
  if (redisClient) {
    redisClient.publish(TRACKER_CHANNELS.MILESTONE, JSON.stringify({ orderDisplayId, payload })).catch((err) => {
      logger.error({ err }, '[Tracker] Redis publish error for milestone');
      deliverToLocalSubscribers(orderDisplayId, payload);
    });
  } else {
    deliverToLocalSubscribers(orderDisplayId, payload);
  }
}

export function broadcastOrderEta(orderDisplayId, eta) {
  if (!orderDisplayId || !eta) return;
  const payload = JSON.stringify({
    event: 'eta_update',
    data: { order_display_id: orderDisplayId, eta, timestamp: new Date().toISOString() },
  });

  initRedisTrackerPubSub();
  if (redisClient) {
    redisClient.publish(TRACKER_CHANNELS.ETA, JSON.stringify({ orderDisplayId, payload })).catch((err) => {
      logger.error({ err }, '[Tracker] Redis publish error for ETA');
      deliverToLocalSubscribers(orderDisplayId, payload);
    });
  } else {
    deliverToLocalSubscribers(orderDisplayId, payload);
  }
}

// =====================================================================
// SUBSCRIPTION HANDLING
// =====================================================================
export async function handleSubscribe(ws, data) {
  const { order_display_id, driver_id } = data;
  const targetId = order_display_id || driver_id;

  if (!targetId) {
    return ws.send(JSON.stringify({ error: 'Subscription target (order_display_id or driver_id) is missing.' }));
  }

  if (!(await canSubscribe(ws, { order_display_id, driver_id }))) {
    return ws.send(JSON.stringify({ error: 'Forbidden: You are not authorized to subscribe to this tracking target.' }));
  }

  if (!trackingSubscriptions.has(targetId)) trackingSubscriptions.set(targetId, new Set());
  trackingSubscriptions.get(targetId).add(ws);
  ws.subscriptionTargets ??= new Set();
  ws.subscriptionTargets.add(targetId);

  if (redisClient) {
    try {
      const subscriberId = ws.user?.id || ws.driverId;
      if (subscriberId) {
        await redisClient.sadd(`user:subscriptions:${subscriberId}`, targetId);
        await redisClient.persist(`user:subscriptions:${subscriberId}`);
      }
    } catch (err) {
      logger.error({ err }, 'Redis subscription persistence error');
    }
  }

  ws.send(JSON.stringify({ status: 'subscribed', target: targetId, reconnect_supported: true }));
}

async function canSubscribe(ws, { order_display_id, driver_id }) {
  const userId = ws.user?.id || ws.driverId;
  const userRole = ws.user?.role;
  if (!userId) return false;

  if (driver_id) {
    if (driver_id === userId || driver_id === ws.driverId) return true;
    if (_orderRepository && userRole === 'customer') {
      const { data: linkedOrder, error } = await _orderRepository.findActiveOrderForDriverByCustomer(userId, driver_id, 'id, order_display_id');
      if (!error && linkedOrder) return true;
    }
    return false;
  }

  if (!order_display_id || !_orderRepository) return false;
  const { data: order, error } = await _orderRepository.findOrderByDisplayId(order_display_id, 'customer_id, driver_id');
  if (error || !order) return false;

  return order.customer_id === userId || order.driver_id === userId;
}

async function handleUnsubscribe(ws, data) {
  const { order_display_id, driver_id } = data;
  const targetId = order_display_id || driver_id;

  if (targetId && trackingSubscriptions.has(targetId)) {
    trackingSubscriptions.get(targetId).delete(ws);
    ws.subscriptionTargets?.delete(targetId);

    if (redisClient) {
      const subscriberId = ws.user?.id || ws.driverId;
      try {
        if (subscriberId) await redisClient.srem(`user:subscriptions:${subscriberId}`, targetId);
      } catch (err) {
        logger.error({ err }, 'Redis subscription cleanup error');
      }
    }

    if (trackingSubscriptions.get(targetId).size === 0) {
      trackingSubscriptions.delete(targetId);
      const channelKeys = displayIdToLocationChannelKeys.get(targetId);
      if (channelKeys) {
        for (const uuidKey of channelKeys) {
          if (locationChannels.has(uuidKey)) {
            const channel = locationChannels.get(uuidKey);
            if (supabase) supabase.removeChannel(channel);
            locationChannels.delete(uuidKey);
          }
        }
        displayIdToLocationChannelKeys.delete(targetId);
      }
    }

    ws.send(JSON.stringify({ status: 'unsubscribed', target: targetId }));
  }
}

async function removeClientFromAllSubscriptions(ws) {
  trackingSubscriptions.forEach((clients, key) => {
    if (clients.has(ws)) clients.delete(ws);
    if (clients.size === 0) {
      trackingSubscriptions.delete(key);
      const channelKeys = displayIdToLocationChannelKeys.get(key);
      if (channelKeys) {
        for (const uuidKey of channelKeys) {
          if (locationChannels.has(uuidKey)) {
            const channel = locationChannels.get(uuidKey);
            if (supabase) supabase.removeChannel(channel);
            locationChannels.delete(uuidKey);
          }
        }
        displayIdToLocationChannelKeys.delete(key);
      }
    }
  });

  if (ws.driverId) consecutiveDropCount.delete(ws.driverId);
  if (ws.socketId) messageRateTracker.delete(ws.socketId);

  if (redisClient) {
    const subscriberId = ws.user?.id || ws.driverId;
    if (subscriberId) {
      let hasOtherSockets = false;
      if (wsServer?.clients) {
        for (const client of wsServer.clients) {
          if (client !== ws && client.readyState === 1 && (client.user?.id || client.driverId) === subscriberId) {
            hasOtherSockets = true;
            break;
          }
        }
      }
      if (!hasOtherSockets) {
        try {
          await redisClient.expire(`user:subscriptions:${subscriberId}`, 3600);
        } catch (err) {
          logger.error({ err }, 'Redis subscription expire error on disconnect');
        }
        await invalidateDriverOrderCache(subscriberId);
      }
    }
  }
}

async function removeDriverLocationChannels(driverId) {
  if (!driverId) return;
  const channelKeys = driverToLocationChannels.get(driverId);
  if (!channelKeys) return;
  for (const uuidKey of channelKeys) {
    const channel = locationChannels.get(uuidKey);
    if (channel) {
      if (supabase) supabase.removeChannel(channel);
      locationChannels.delete(uuidKey);
    }
    displayIdToLocationChannelKeys.forEach((set, displayId) => {
      if (set.delete(uuidKey) && set.size === 0) displayIdToLocationChannelKeys.delete(displayId);
    });
  }
  driverToLocationChannels.delete(driverId);
}

async function restoreSubscriptions(ws) {
  const subscriberId = ws.user?.id || ws.driverId;
  if (!redisClient || !subscriberId) return;

  try {
    const targets = await redisClient.smembers(`user:subscriptions:${subscriberId}`);
    ws.subscriptionTargets ??= new Set();

    if (targets.length > 0) await redisClient.persist(`user:subscriptions:${subscriberId}`);

    for (const targetId of targets) {
      const allowed = await canSubscribe(
        ws,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)
          ? { driver_id: targetId }
          : { order_display_id: targetId }
      );

      if (!allowed) {
        await redisClient.srem(`user:subscriptions:${subscriberId}`, targetId);
        continue;
      }

      if (!trackingSubscriptions.has(targetId)) trackingSubscriptions.set(targetId, new Set());
      trackingSubscriptions.get(targetId).add(ws);
      ws.subscriptionTargets.add(targetId);
    }
  } catch (err) {
    logger.error({ err }, 'Subscription restoration error');
  }
}

// =====================================================================
// EXPORT FOR TESTING
// =====================================================================
export const __testing = {
  resetTrackingSubscriptions() { trackingSubscriptions.clear(); },
  setOrderRepository(repo) { _orderRepository = repo; },
  async restoreSubscriptions(ws) { await restoreSubscriptions(ws); },
  getTrackingSubscriptions() { return trackingSubscriptions; },
  setTrackingSubscriptions(map) { trackingSubscriptions = map; },
  setLocationEventBus(bus) { locationEventBus = bus; },
  getLocationEventBus() { return locationEventBus; },
  createLocationEventHandler,
  getLocationEventBusMetrics() { return locationEventBus ? locationEventBus.getMetrics() : null; },
  flushTelemetryBuffer() { return telemetryBuffer._test.flush(); },
  removeClientFromAllSubscriptions,
  getTelemetryWriteBuffer() { return telemetryBuffer._test.getBuffer(); },
  getTelemetryFlushBuffer() { return telemetryBuffer._test.getRetryQueue(); },
  async setTelemetryWriteBuffer(records) { await telemetryBuffer._test.setBuffer(records); },
  setTelemetryFlushBuffer(records) { telemetryBuffer._test.setRetryQueue(records); },
  async pushToTelemetryWriteBuffer(records) { await telemetryBuffer._test.push(records); },
  async clearTelemetryWriteBuffer() { await telemetryBuffer._test.clearBuffer(); },
  clearTelemetryFlushBuffer() { telemetryBuffer._test.setRetryQueue([]); },
  getTelemetryBufferMetrics() { return telemetryBuffer.getMetrics(); },
  getShutdownState() {
    const state = {
      isSchedulerActive,
      hasTelemetryFlushInterval: Boolean(telemetryFlushTimeout),
      hasWebSocketServer: Boolean(wsServer),
      hasWsHeartbeatInterval: Boolean(wsHeartbeatInterval),
    };
    Object.defineProperty(state, 'pubSub', {
      enumerable: true,
      configurable: true,
      get() { return locationEventBus ? locationEventBus.getState() : null; },
    });
    return state;
  },
  setShutdownState({ telemetryInterval = null, heartbeatInterval = null, server = null } = {}) {
    telemetryFlushTimeout = telemetryInterval;
    wsHeartbeatInterval = heartbeatInterval;
    wsServer = server;
    isSchedulerActive = Boolean(telemetryInterval);
  },
  setMongoDbOverride(val) { telemetryBuffer._test.setMongoDbOverride(val); },
  getConsecutiveDropCount(driverId) { const entry = consecutiveDropCount.get(driverId); return entry ? entry.count : 0; },
  clearConsecutiveDropCount() { consecutiveDropCount.clear(); },
  getConsecutiveDropCountSize() { return consecutiveDropCount.size; },
  getConsecutiveDropCountEntry(driverId) { return consecutiveDropCount.get(driverId) || null; },
  getDriverStateTtlMs() { return TRACKER_DRIVER_STATE_TTL_MS; },
  sweepStaleDriverState,
  setLastDriverStateSweep(val) { lastDriverStateSweep = val; },
  get MAX_CONSECUTIVE_DROPS() { return MAX_CONSECUTIVE_DROPS; },
  WS_MAX_PAYLOAD_BYTES,
  getCachedDriverOrder,
  setCachedDriverOrder,
  invalidateDriverOrderCache,
  DRIVER_ORDER_CACHE_KEY_PREFIX,
  DRIVER_ORDER_CACHE_TTL_SECONDS,
};
