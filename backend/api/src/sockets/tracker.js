import { WebSocketServer } from 'ws';
import { mongoDb, redisClient, firebaseAdmin, supabase } from '../config/db.js';
import jwt from 'jsonwebtoken';
import logger from '../middleware/logger.js';
import os from 'os';
import path from 'path';
import fs from 'fs';

let mongoDbOverride = null;
const getMongoDb = () => mongoDbOverride || mongoDb;

let telemetryDropCounter = 0;
const RECOVERY_FILE_PATH = path.join(os.tmpdir(), 'truxify-telemetry-recovery.jsonl');

// In-memory mapping of active client subscriptions
const trackingSubscriptions = new Map();

// Cached Supabase Realtime channels keyed by orderUUID to avoid creating a new
// channel per location ping. Reused across pings and cleaned up on disconnect.
const locationChannels = new Map();

// =====================================================================
// CLOCK SKEW & CIRCUIT BREAKER CONFIGURATION (#596)
// =====================================================================
const CLOCK_SKEW_TOLERANCE_MS = parseInt(process.env.CLOCK_SKEW_TOLERANCE_MS, 10) || 300000; // default ±5 min
const MAX_CONSECUTIVE_DROPS = 10;
const consecutiveDropCount = new Map();

// =====================================================================
// EXTRA STORAGE & BUFFER CONFIGURATIONS (#269)
// =====================================================================
const MAX_BUFFER_SIZE = 5000;
const BUFFER_WARN_THRESHOLD = 0.5;
const BUFFER_CRIT_THRESHOLD = 0.8;
const BUFFER_MONITOR_INTERVAL_MS = 30000;
let telemetryWriteBuffer = [];
let telemetryFlushBuffer = [];
let currentFlushPromise = null;
let flushMutex = false;
const BUFFER_FLUSH_INTERVAL_MS = 20000;
let flushBackoffMs = 1000;
let isSchedulerActive = false;
let telemetryFlushTimeout = null;
let wsServer = null;
let wsHeartbeatInterval = null;
let telemetryMonitorInterval = null;

// Observability counters
let telemetryTotalFlushed = 0;
let telemetryTotalDropped = 0;
let telemetryRaceDropped = 0;
let telemetryOverflowDropped = 0;

const WS_UPGRADE_RATE_LIMIT = 5;
const WS_UPGRADE_RATE_WINDOW_SECONDS = 60;
const MAX_MSG_PER_SECOND = 10;
const messageRateTracker = new WeakMap();

function getClientIp(request) {
  const forwardedFor = request.headers?.['x-forwarded-for'];

  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return request.socket?.remoteAddress || request.connection?.remoteAddress || 'unknown';
}

export async function isWebSocketUpgradeAllowed(request) {
  if (!redisClient) {
    return true;
  }

  const ipAddress = getClientIp(request);
  const key = `ws:upgrade:${ipAddress}`;

  try {
    const attempts = await redisClient.incr(key);

    if (attempts === 1) {
      await redisClient.expire(key, WS_UPGRADE_RATE_WINDOW_SECONDS);
    } else {
      const ttl = await redisClient.ttl(key);
      if (ttl === -1) {
        await redisClient.expire(key, WS_UPGRADE_RATE_WINDOW_SECONDS);
      }
    }

    return attempts <= WS_UPGRADE_RATE_LIMIT;
  } catch (err) {
    logger.error('Redis WebSocket upgrade rate limit error:', err.message);
    return true;
  }
}

export function rejectWebSocketUpgrade(socket) {
  socket.write(
    'HTTP/1.1 429 Too Many Requests\r\n' +
    'Connection: close\r\n' +
    '\r\n'
  );
  socket.destroy();
}

/**
 * Initialize WebSockets Server and bind event handlers
 */
export function initWebSocketServer(server) {
  const wss = new WebSocketServer({ noServer: true });
  wsServer = wss;

  server.on('upgrade', async (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;

    if (pathname === '/ws/tracking') {
      const allowed = await isWebSocketUpgradeAllowed(request);

      if (!allowed) {
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
    const reqUrl = new URL(req.url, 'http://localhost');
    const token    = reqUrl.searchParams.get('token');
    const bypassAuth = process.env.BYPASS_AUTH === 'true';

    if (bypassAuth) {
      if (process.env.NODE_ENV === 'production') {
        ws.close(4003, 'BYPASS_AUTH is not allowed in production');
        return;
      }
      ws.driverId = reqUrl.searchParams.get('driver_id') || 'test_driver';
      ws.user = {
        id: reqUrl.searchParams.get('user_id') || ws.driverId,
        role: reqUrl.searchParams.get('user_role') || 'driver',
      };
      logger.info(`🔓 WS Auth bypassed for driver: ${ws.driverId}`);
    } else {
      if (!token) {
        ws.close(4001, 'Unauthorized: No token provided');
        return;
      }
      try {
        let decoded = null;
        try {
          decoded = jwt.decode(token);
        } catch (err) {
          // ignore decoding errors
        }

        const isSupabaseToken = decoded &&
          typeof decoded === 'object' &&
          typeof decoded.iss === 'string' &&
          (decoded.iss.includes('supabase') || decoded.iss.includes('supabase.co'));
        let profile = null;

        if (isSupabaseToken) {
          if (!supabase) {
            ws.close(4001, 'Unauthorized: Supabase client is not configured');
            return;
          }
          const response = await supabase.auth.getUser(token);
          const user = response?.data?.user;
          const authError = response?.error;
          if (authError || !user) {
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
            ws.close(4001, 'Unauthorized: User profile not found');
            return;
          }
          profile = userProfile;
        } else {
          // Firebase Verification
          if (!firebaseAdmin) {
            ws.close(4001, 'Unauthorized: Firebase Auth is not configured');
            return;
          }
          const decodedToken = await firebaseAdmin.auth().verifyIdToken(token);
          if (!supabase) {
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
            ws.close(4001, 'Unauthorized: User profile not found');
            return;
          }
          profile = userProfile;
        }

        ws.user = {
          id: profile.id,
          uid: profile.firebase_uid,
          role: profile.role,
        };
        ws.driverId = profile.id;
        await restoreSubscriptions(ws);
        logger.info(`✅ WS Authenticated user: ${ws.user.id}`);
      } catch (err) {
        logger.error({ err }, 'WS Auth failed');
        ws.close(4001, 'Unauthorized: Invalid token');
        return;
      }
    }

    logger.info('🔌 New WebSocket connection established on /ws/tracking');
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      handleTrackingMessage(ws, message);
    });

    ws.on('close', () => {
      logger.info('🔌 WebSocket connection closed.');
      void (async () => {
        await removeClientFromAllSubscriptions(ws);
      })();
    });

    ws.on('error', (err) => {
      logger.error('🔌 WebSocket client error:', err.message);
      void (async () => {
        await removeClientFromAllSubscriptions(ws);
      })();
    });
  });

  wsHeartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        logger.info('🔌 Terminating unresponsive WebSocket client.');
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    if (wsHeartbeatInterval) {
      clearInterval(wsHeartbeatInterval);
      wsHeartbeatInterval = null;
    }
  });

  if (!isSchedulerActive) {
    initTelemetryScheduler();
  }

  logger.info('🚀 WebSocket tracking router initialized.');
}

function isMessageRateLimited(ws) {
  const now = Date.now();
  let state = messageRateTracker.get(ws);
  if (!state || now - state.windowStart >= 1000) {
    state = { count: 0, windowStart: now };
    messageRateTracker.set(ws, state);
  }
  state.count++;
  return state.count > MAX_MSG_PER_SECOND;
}

export async function handleTrackingMessage(ws, message) {
  if (isMessageRateLimited(ws)) {
    return;
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

    switch (event) {
      case 'location_ping':
        await handleLocationPing(ws, data);
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
    logger.error('WS Message parsing error:', err.message);
    ws.send(JSON.stringify({ error: 'Invalid JSON payload structure.' }));
  }
}

export async function handleLocationPing(ws, data) {
  const driver_id = ws.driverId;

  if (!driver_id) {
    return ws.send(JSON.stringify({ error: 'Unauthorized: Missing authenticated WebSocket identity.' }));
  }

  const { driver_id: payloadDriverId, speed, bearing, device_timestamp } = data;

  if (payloadDriverId && payloadDriverId !== driver_id) {
    const clientIp = ws.upgradeReq?.socket?.remoteAddress || 'unknown';
    logger.error({
      event: 'SPOOFED_LOCATION_ATTEMPT',
      authenticatedDriver: driver_id,
      attemptedDriver: payloadDriverId,
      ip: clientIp,
      timestamp: new Date().toISOString(),
    }, 'Location spoofing attempt detected: Driver ID mismatch');

    if (typeof ws.close === 'function') {
      ws.close(4010, 'Spoofed location detected: Driver ID mismatch');
    }
    return;
  }

  // Also validate if payload provides driver_id that it must not be different
  if (!payloadDriverId) {
    // If not provided, add the authenticated driver_id to data
    data.driver_id = driver_id;
  }

  const lat = data.lat !== undefined ? data.lat : data.latitude;
  const lng = data.lng !== undefined ? data.lng : data.longitude;

  // Fix 3: Coordinate validation — proper null/undefined, type, and range validation
  if (lat === null || lat === undefined || typeof lat !== 'number' || !Number.isFinite(lat) ||
      lng === null || lng === undefined || typeof lng !== 'number' || !Number.isFinite(lng)) {
    return ws.send(JSON.stringify({ error: 'Missing mandatory tracking parameters (lat, lng).' }));
  }

  // Range validation
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return ws.send(JSON.stringify({ error: 'Coordinates out of valid range' }));
  }

  // Parse device timestamp for analytics and clock skew check only (Fix 1)
  let deviceTime = null;
  if (device_timestamp) {
    const parsedEpoch = Date.parse(device_timestamp);
    if (isNaN(parsedEpoch)) {
      logger.error(`[TRUXIFY VALIDATION ERROR] Malformed device_timestamp received from driver: ${driver_id}. Falling back to server time.`);
    } else {
      deviceTime = new Date(parsedEpoch);
    }
  }

  // Clock skew validation — compare device time against server time with a configurable tolerance
  const skewCheckTime = deviceTime || new Date();
  const skewMs = Math.abs(skewCheckTime.getTime() - Date.now());
  if (skewMs > CLOCK_SKEW_TOLERANCE_MS) {
    logger.warn(
      `[TRUXIFY CLOCK SKEW] Driver ${driver_id} clock skew ${skewMs}ms exceeds tolerance ` +
      `${CLOCK_SKEW_TOLERANCE_MS}ms — ignoring update.`
    );
    return;
  }

  // Fix 1: Always use server time for sequence comparison
  const serverNow = Date.now();

  // Fix 4: IDEMPOTENCY GATE & OUT-OF-ORDER SEQUENCER + Circuit breaker
  if (redisClient) {
    try {
      const seqKey = `driver:sequence:${driver_id}`;
      const lastRecordedEpochStr = await redisClient.get(seqKey);

      if (lastRecordedEpochStr) {
        const lastRecordedEpoch = parseInt(lastRecordedEpochStr, 10);

        if (serverNow <= lastRecordedEpoch) {
          logger.warn(`[TRUXIFY SEQUENCE CONTROL] Out-of-order telemetry dropped for Driver: ${driver_id}. Stale jitter detected.`);

          // Circuit breaker: if too many consecutive drops, reset the sequence
          const currentCount = (consecutiveDropCount.get(driver_id) || 0) + 1;
          consecutiveDropCount.set(driver_id, currentCount);
          if (currentCount >= MAX_CONSECUTIVE_DROPS) {
            logger.warn(
              `[TRUXIFY CIRCUIT BREAKER] Driver ${driver_id} exceeded max consecutive drops ` +
              `(${MAX_CONSECUTIVE_DROPS}). Resetting sequence.`
            );
            await redisClient.del(seqKey);
            consecutiveDropCount.delete(driver_id);
          }
          return;
        }
      }

      // Reset circuit breaker on successful sequence advancement
      consecutiveDropCount.delete(driver_id);
      await redisClient.set(seqKey, serverNow.toString(), 'EX', 86400);
    } catch (err) {
      logger.error('Redis sequence verification cache error:', err.message);
    }
  }

  // Resolve order details from Supabase
  let orderUUID = data.orderId || data.order_id || null;
  let orderDisplayId = data.order_display_id || null;

  if (supabase && (orderUUID || orderDisplayId)) {
    try {
      let query = supabase.from('orders').select('id, order_display_id');
      if (orderUUID && orderUUID.includes('-')) {
        query = query.eq('id', orderUUID);
      } else if (orderDisplayId) {
        query = query.eq('order_display_id', orderDisplayId);
      } else {
        query = query.eq('order_display_id', orderUUID);
      }
      const { data: order } = await query.maybeSingle();
      if (order) {
        orderUUID = order.id;
        orderDisplayId = order.order_display_id;
      }
    } catch (err) {
      logger.error('Failed to resolve order details in tracker:', err.message);
    }
  }

  // Buffer write with capacity limit (always push to active buffer)
  if (telemetryWriteBuffer.length >= MAX_BUFFER_SIZE) {
    const dropCount = Math.floor(MAX_BUFFER_SIZE * 0.1);
    telemetryWriteBuffer.splice(0, dropCount);
    telemetryTotalDropped += dropCount;
    telemetryOverflowDropped += dropCount;
    logger.warn(`[TRUXIFY BUFFER WARN] Telemetry buffer full: dropped ${dropCount} oldest records. Total dropped: ${telemetryTotalDropped}. Size: ${telemetryWriteBuffer.length}/${MAX_BUFFER_SIZE}`);
  }
  telemetryWriteBuffer.push({
    driver_id,
    order_id: orderUUID || null,
    order_display_id: orderDisplayId || null,
    lat,
    lng,
    location: {
      type: 'Point',
      coordinates: [parseFloat(lng), parseFloat(lat)]
    },
    speed_kmh: speed || 0,
    bearing_deg: bearing || 0,
    timestamp: deviceTime || new Date(),
    pinged_at: deviceTime || new Date(),
    buffered_at: new Date(),
    server_received_at: new Date(serverNow),
  });

  // Buffer usage monitoring
  const usagePct = (telemetryWriteBuffer.length / MAX_BUFFER_SIZE) * 100;
  if (usagePct >= 80) {
    logger.warn(`[TRUXIFY BUFFER CRITICAL] Buffer at ${usagePct.toFixed(0)}% capacity (${telemetryWriteBuffer.length}/${MAX_BUFFER_SIZE})`);
  } else if (usagePct >= 50 && usagePct < 60) {
    logger.warn(`[TRUXIFY BUFFER WARN] Buffer at ${usagePct.toFixed(0)}% capacity (${telemetryWriteBuffer.length}/${MAX_BUFFER_SIZE})`);
  }

  if (redisClient) {
    try {
      const redisKey = `driver:location:${driver_id}`;
      await redisClient.set(
        redisKey,
        JSON.stringify({ latitude: lat, longitude: lng, speed: speed || 0, bearing: bearing || 0, updated_at: new Date(serverNow) }),
        'EX',
        120
      );
    } catch (err) {
      logger.error('Redis cache telemetry error:', err.message);
    }
  }

  const broadcastPayload = JSON.stringify({
    event: 'location_update',
    data: {
      driver_id,
      order_display_id: orderDisplayId,
      latitude: lat,
      longitude: lng,
      speed: speed || 0,
      bearing: bearing || 0,
      timestamp: new Date(serverNow)
    }
  });

  if (orderDisplayId && trackingSubscriptions.has(orderDisplayId)) {
    const clients = trackingSubscriptions.get(orderDisplayId);
    clients.forEach((client) => {
      if (client.readyState === 1) { 
        client.send(broadcastPayload);
      }
    });
  }

  if (trackingSubscriptions.has(driver_id)) {
    const clients = trackingSubscriptions.get(driver_id);
    clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(broadcastPayload);
      }
    });
  }

  // Publish to Supabase Realtime channel driver-location:{orderId}
  // Reuse cached channel to avoid creating a new channel per ping.
  if (supabase && orderUUID) {
    if (!locationChannels.has(orderUUID)) {
      const channel = supabase.channel(`driver-location:${orderUUID}`);
      channel.subscribe();
      locationChannels.set(orderUUID, channel);
    }
    const channel = locationChannels.get(orderUUID);
    channel.send({
      type: 'broadcast',
      event: 'location',
      payload: {
        orderId: orderUUID,
        driverId: driver_id,
        lat,
        lng,
        timestamp: new Date(serverNow).toISOString()
      }
    }).catch((err) => {
      logger.error('Failed to broadcast realtime location to Supabase:', err.message);
    });
  }
}

/**
 * Periodically dumps the aggregated batch matrix logs into MongoDB Atlas
 */
async function flushTelemetryBuffer() {
  if (currentFlushPromise) {
    return currentFlushPromise;
  }

  if (telemetryWriteBuffer.length === 0 && telemetryFlushBuffer.length === 0) {
    flushBackoffMs = 1000;
    return;
  }

  if (!getMongoDb()) {
    logger.error('[TRUXIFY STORAGE WARN] MongoDB is not initialized or disconnected. Retaining telemetry logs in memory buffer.');
    return;
  }

  if (flushMutex) return;
  flushMutex = true;

  const recordsToFlush = [...(telemetryFlushBuffer.length > 0 ? telemetryFlushBuffer : telemetryWriteBuffer)];
  if (telemetryFlushBuffer.length > 0) {
    telemetryFlushBuffer = [];
  }
  telemetryFlushBuffer = telemetryWriteBuffer;
  telemetryWriteBuffer = [];

  if (recordsToFlush.length === 0) {
    flushMutex = false;
    return;
  }

  currentFlushPromise = (async () => {
    logger.info(`[TRUXIFY BATCH CONTROL] Committing bulk cluster of ${recordsToFlush.length} spatial rows to MongoDB...`);

    try {
      const collection = getMongoDb().collection('telemetry');
      await collection.insertMany(recordsToFlush, { ordered: false });
      telemetryTotalFlushed += recordsToFlush.length;
      logger.info(`[TRUXIFY DB SUCCESS] Successfully flushed ${recordsToFlush.length} records to MongoDB telemetry collection. Total flushed: ${telemetryTotalFlushed}`);
      flushBackoffMs = 1000;
    } catch (err) {
      const isBulkWriteError = err.code === 121 || err.name === 'BulkWriteError' || err.message.includes('Document failed validation');

      if (isBulkWriteError) {
        if (err.writeErrors && err.writeErrors.length > 0) {
          const sampleErrors = err.writeErrors.slice(0, 5).map(e =>
            `doc ${e.index}: ${e.err?.message || 'unknown'}`
          ).join('; ');
          logger.error(`[TRUXIFY VALIDATION] ${err.writeErrors.length} documents failed validation. Samples: ${sampleErrors}`);
        } else {
          logger.error(`[TRUXIFY VALIDATION] Bulk insert validation error: ${err.message}`);
        }
        const succeeded = err.writeErrors
          ? recordsToFlush.filter((_, i) => !err.writeErrors.some(e => e.index === i))
          : [];
        if (succeeded.length > 0) {
          telemetryWriteBuffer = [...succeeded, ...telemetryWriteBuffer];
          if (telemetryWriteBuffer.length > MAX_BUFFER_SIZE) {
            const overflowDrop = telemetryWriteBuffer.length - MAX_BUFFER_SIZE;
            telemetryWriteBuffer.splice(0, overflowDrop);
            telemetryTotalDropped += overflowDrop;
            telemetryOverflowDropped += overflowDrop;
            logger.warn(`[TRUXIFY BUFFER DROP] Dropped ${overflowDrop} oldest records due to capacity after partial insert.`);
          }
        }
      } else {
        flushBackoffMs = Math.min(flushBackoffMs * 2, 60000);
        telemetryFlushBuffer = [...recordsToFlush, ...telemetryFlushBuffer];
        if (telemetryFlushBuffer.length > MAX_BUFFER_SIZE) {
          const overflowDrop = telemetryFlushBuffer.length - MAX_BUFFER_SIZE;
          telemetryFlushBuffer.splice(0, overflowDrop);
          telemetryTotalDropped += overflowDrop;
          telemetryOverflowDropped += overflowDrop;
          logger.warn(`[TRUXIFY BUFFER DROP] Capacity limit: dropped ${overflowDrop} oldest records from retry merge. Total dropped: ${telemetryTotalDropped}`);
        }
      }
    } finally {
      currentFlushPromise = null;
      flushMutex = false;
    }
  })();

  return currentFlushPromise;
}

function monitorBufferSize() {
  const activeLen = telemetryWriteBuffer.length;
  const flushLen = telemetryFlushBuffer.length;
  const totalLen = activeLen + flushLen;
  const usagePct = totalLen / MAX_BUFFER_SIZE;
  if (usagePct >= BUFFER_CRIT_THRESHOLD) {
    logger.warn(
      `[TRUXIFY BUFFER MONITOR] CRITICAL: Buffer at ${(usagePct * 100).toFixed(0)}% ` +
      `(${totalLen}/${MAX_BUFFER_SIZE}) [active=${activeLen} flush=${flushLen}] ` +
      `flushed=${telemetryTotalFlushed} dropped=${telemetryTotalDropped}`
    );
  } else if (usagePct >= BUFFER_WARN_THRESHOLD) {
    logger.warn(
      `[TRUXIFY BUFFER MONITOR] WARNING: Buffer at ${(usagePct * 100).toFixed(0)}% ` +
      `(${totalLen}/${MAX_BUFFER_SIZE}) [active=${activeLen} flush=${flushLen}] ` +
      `flushed=${telemetryTotalFlushed} dropped=${telemetryTotalDropped}`
    );
  }
}

function scheduleNextFlush() {
  if (!isSchedulerActive) return;

  telemetryFlushTimeout = setTimeout(async () => {
    try {
      await flushTelemetryBuffer();
    } finally {
      scheduleNextFlush();
    }
  }, Math.max(BUFFER_FLUSH_INTERVAL_MS, flushBackoffMs));
}

function loadRecoveryFile() {
  try {
    if (fs.existsSync(RECOVERY_FILE_PATH)) {
      const content = fs.readFileSync(RECOVERY_FILE_PATH, 'utf-8').trim();
      if (content) {
        const records = content.split('\n').filter(Boolean).map(line => JSON.parse(line));
        if (records.length > 0) {
          telemetryWriteBuffer = [...records, ...telemetryWriteBuffer].slice(-MAX_BUFFER_SIZE);
          logger.info(`[TRUXIFY RECOVERY] Loaded ${records.length} telemetry records from recovery file. Buffer size: ${telemetryWriteBuffer.length}`);
        }
      }
      fs.unlinkSync(RECOVERY_FILE_PATH);
    }
  } catch (err) {
    logger.error('[TRUXIFY RECOVERY] Failed to load recovery file:', err.message);
    try { fs.unlinkSync(RECOVERY_FILE_PATH); } catch (_) { /* ignore */ }
  }
}

function initTelemetryScheduler() {
  loadRecoveryFile();
  isSchedulerActive = true;
  scheduleNextFlush();
  
  telemetryMonitorInterval = setInterval(() => {
    monitorBufferSize();
  }, BUFFER_MONITOR_INTERVAL_MS);
}

export async function closeWebSocketServer() {
  if (telemetryFlushTimeout) {
    clearTimeout(telemetryFlushTimeout);
    telemetryFlushTimeout = null;
    isSchedulerActive = false;
  }

  if (telemetryMonitorInterval) {
    clearInterval(telemetryMonitorInterval);
    telemetryMonitorInterval = null;
  }

  if (wsHeartbeatInterval) {
    clearInterval(wsHeartbeatInterval);
    wsHeartbeatInterval = null;
  }

  // Wait for MongoDB to be available before final flush
  const parsedWait = parseInt(process.env.MONGODB_SHUTDOWN_WAIT_MS, 10);
  const mongoMaxWaitMs = isNaN(parsedWait) ? 10000 : parsedWait;
  if (mongoMaxWaitMs > 0) {
    const mongoPollIntervalMs = Math.min(500, mongoMaxWaitMs);
    const mongoWaitStart = Date.now();
    while (!getMongoDb() && Date.now() - mongoWaitStart < mongoMaxWaitMs) {
      await new Promise(r => setTimeout(r, mongoPollIntervalMs));
    }
    if (!getMongoDb()) {
      const dataLoss = telemetryWriteBuffer.length;
      if (dataLoss > 0) {
        try {
          const lines = telemetryWriteBuffer.map(r => JSON.stringify(r)).join('\n');
          fs.writeFileSync(RECOVERY_FILE_PATH, lines + '\n', 'utf-8');
          logger.warn(`[TRUXIFY SHUTDOWN] MongoDB not available. Wrote ${dataLoss} telemetry records to recovery file: ${RECOVERY_FILE_PATH}`);
        } catch (fileErr) {
          logger.error(`[TRUXIFY SHUTDOWN] Failed to write recovery file: ${fileErr.message}. ${dataLoss} records lost.`);
        }
      }
    }
  }

  // Wait for any in-flight flush to complete
  if (currentFlushPromise) {
    try {
      await currentFlushPromise;
    } catch (err) {
      // Ignore errors; final flush retry will handle them
    }
  }

  try {
    await flushTelemetryBuffer();
  } catch (err) {
    logger.error('[shutdown] Failed to flush telemetry buffer:', err.message);
  }

  if (!wsServer) {
    return;
  }

  const serverToClose = wsServer;
  wsServer = null;

  await new Promise((resolve) => {
    serverToClose.clients?.forEach((client) => {
      try {
        client.close(1001, 'Server shutting down');
      } catch (err) {
        logger.error('[shutdown] Failed to close WebSocket client:', err.message);
      }
    });

    serverToClose.close((err) => {
      if (err) {
        logger.error('[shutdown] WebSocket server close error:', err.message);
      }
      resolve();
    });
  });
}

export async function handleSubscribe(ws, data) {
  const { order_display_id, driver_id } = data;
  const targetId = order_display_id || driver_id;

  if (!targetId) {
    return ws.send(JSON.stringify({ error: 'Subscription target (order_display_id or driver_id) is missing.' }));
  }

  const authorized = await canSubscribe(ws, { order_display_id, driver_id });

  if (!authorized) {
    return ws.send(JSON.stringify({ error: 'Forbidden: You are not authorized to subscribe to this tracking target.' }));
  }

  if (!trackingSubscriptions.has(targetId)) {
    trackingSubscriptions.set(targetId, new Set());
  }

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
      logger.error('Redis subscription persistence error:', err.message);
    }
  }

  logger.info(`🔌 Client subscribed to telemetry updates for: "${targetId}"`);
  ws.send(JSON.stringify({ status: 'subscribed', target: targetId, reconnect_supported: true }));
}

async function canSubscribe(ws, { order_display_id, driver_id }) {
  const userId = ws.user?.id || ws.driverId;
  const userRole = ws.user?.role;

  if (!userId) {
    return false;
  }

  if (driver_id) {
    return driver_id === userId || driver_id === ws.driverId;
  }

  if (!order_display_id || !supabase) {
    return false;
  }

  const { data: order, error } = await supabase
    .from('orders')
    .select('customer_id, driver_id')
    .eq('order_display_id', order_display_id)
    .maybeSingle();

  if (error || !order) {
    return false;
  }

  if (userRole === 'customer') {
    return order.customer_id === userId;
  }

  if (userRole === 'driver') {
    return order.driver_id === userId;
  }

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
        if (subscriberId) {
          await redisClient.srem(`user:subscriptions:${subscriberId}`, targetId);
        }
      } catch (err) {
        logger.error('Redis subscription cleanup error:', err.message);
      }
    }

    logger.info(`🔌 Client unsubscribed from updates for: "${targetId}"`);
    ws.send(JSON.stringify({ status: 'unsubscribed', target: targetId }));
  }
}

async function removeClientFromAllSubscriptions(ws) {
  trackingSubscriptions.forEach((clients, key) => {
    if (clients.has(ws)) {
      clients.delete(ws);
      logger.info(`🔌 Removed socket subscription from "${key}" due to disconnect.`);
    }
    if (clients.size === 0) {
      trackingSubscriptions.delete(key);
      // Clean up the cached Supabase Realtime channel for this orderUUID
      // so channels do not leak after the last subscriber disconnects.
      if (locationChannels.has(key)) {
        const channel = locationChannels.get(key);
        // Guard against supabase being null (e.g. not configured in dev/test environments)
        if (supabase) {
          supabase.removeChannel(channel);
        }
        locationChannels.delete(key);
        logger.info(`🔌 Removed Supabase Realtime channel for order "${key}" on last subscriber disconnect.`);
      }
    }
  });

  if (redisClient) {
    const subscriberId = ws.user?.id || ws.driverId;
    if (subscriberId) {
      let hasOtherSockets = false;
      if (wsServer && wsServer.clients) {
        for (const client of wsServer.clients) {
          if (client !== ws && client.readyState === 1) {
            const clientUserId = client.user?.id || client.driverId;
            if (clientUserId === subscriberId) {
              hasOtherSockets = true;
              break;
            }
          }
        }
      }
      if (!hasOtherSockets) {
        try {
          await redisClient.expire(`user:subscriptions:${subscriberId}`, 3600);
        } catch (err) {
          logger.error('Redis subscription expire error on disconnect:', err.message);
        }
      }
    }
  }
}

async function restoreSubscriptions(ws) {
  const subscriberId = ws.user?.id || ws.driverId;
  if (!redisClient || !subscriberId) return;

  try {
    const targets = await redisClient.smembers(`user:subscriptions:${subscriberId}`);

    ws.subscriptionTargets ??= new Set();

    if (targets.length > 0) {
      await redisClient.persist(`user:subscriptions:${subscriberId}`);
    }

    for (const targetId of targets) {
      const allowed = await canSubscribe(
        ws,
        targetId.startsWith('ORDER-')
          ? { order_display_id: targetId }
          : { driver_id: targetId }
      );

      if (!allowed) {
        await redisClient.srem(`user:subscriptions:${subscriberId}`, targetId);
        continue;
      }

      if (!trackingSubscriptions.has(targetId)) {
        trackingSubscriptions.set(targetId, new Set());
      }

      trackingSubscriptions.get(targetId).add(ws);
      ws.subscriptionTargets.add(targetId);
    }
  } catch (err) {
    logger.error('Subscription restoration error:', err.message);
  }
}

export const __testing = {
  resetTrackingSubscriptions() {
    trackingSubscriptions.clear();
  },
  async restoreSubscriptions(ws) {
    await restoreSubscriptions(ws);
  },
  getTrackingSubscriptions() {
    return trackingSubscriptions;
  },
  flushTelemetryBuffer,
  removeClientFromAllSubscriptions,
  getTelemetryWriteBuffer() {
    return telemetryWriteBuffer;
  },
  setTelemetryWriteBuffer(records) {
    telemetryWriteBuffer = records;
  },
  clearTelemetryWriteBuffer() {
    telemetryWriteBuffer = [];
  },
  getShutdownState() {
    return {
      isSchedulerActive,
      hasTelemetryFlushInterval: Boolean(telemetryFlushTimeout),
      hasWebSocketServer: Boolean(wsServer),
      hasWsHeartbeatInterval: Boolean(wsHeartbeatInterval),
    };
  },
  setShutdownState({ telemetryInterval = null, heartbeatInterval = null, server = null } = {}) {
    telemetryFlushTimeout = telemetryInterval;
    wsHeartbeatInterval = heartbeatInterval;
    wsServer = server;
    isSchedulerActive = Boolean(telemetryInterval);
  },
  setMongoDbOverride(val) {
    mongoDbOverride = val;
  },
  getConsecutiveDropCount(driverId) {
    return consecutiveDropCount.get(driverId) || 0;
  },
  clearConsecutiveDropCount() {
    consecutiveDropCount.clear();
  },
  get MAX_CONSECUTIVE_DROPS() {
    return MAX_CONSECUTIVE_DROPS;
  },
};
