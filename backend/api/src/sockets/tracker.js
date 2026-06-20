import { WebSocketServer } from 'ws';
import { mongoDb, redisClient, firebaseAdmin, supabase } from '../config/db.js';
import jwt from 'jsonwebtoken';
import logger from '../middleware/logger.js';

let mongoDbOverride = null;
const getMongoDb = () => mongoDbOverride || mongoDb;

// In-memory mapping of active client subscriptions
const trackingSubscriptions = new Map();

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
let currentFlushPromise = null;
const BUFFER_FLUSH_INTERVAL_MS = 20000;
let flushBackoffMs = 1000;
let isSchedulerActive = false;
let telemetryFlushTimeout = null;
let wsServer = null;
let wsHeartbeatInterval = null;
let telemetryMonitorInterval = null;

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
      } catch (e) {
        logger.error({ err: e }, 'WS Auth failed');
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

/**
 * Handle incoming GPS coordinate telemetry from a driver app
 */
export async function handleLocationPing(ws, data) {
  const { driver_id: payloadDriverId, order_display_id, latitude, longitude, speed, bearing, device_timestamp } = data;
  const driver_id = ws.driverId;

  if (!driver_id) {
    return ws.send(JSON.stringify({ error: 'Unauthorized: Missing authenticated WebSocket identity.' }));
  }

  if (payloadDriverId && payloadDriverId !== driver_id) {
    return ws.send(JSON.stringify({ error: 'Unauthorized: driver_id does not match authenticated WebSocket identity.' }));
  }

  // Fix 3: Coordinate validation — proper null/undefined, type, and range validation
  if (latitude === null || latitude === undefined || typeof latitude !== 'number' || !Number.isFinite(latitude) ||
      longitude === null || longitude === undefined || typeof longitude !== 'number' || !Number.isFinite(longitude)) {
    return ws.send(JSON.stringify({ error: 'Missing mandatory tracking parameters (lat, lng).' }));
  }

  // Range validation
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
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

  // Buffer write with capacity limit
  if (telemetryWriteBuffer.length >= MAX_BUFFER_SIZE) {
    const dropCount = Math.floor(MAX_BUFFER_SIZE * 0.1);
    telemetryWriteBuffer.splice(0, dropCount);
    logger.warn(`[TRUXIFY BUFFER WARN] Telemetry buffer full: dropped ${dropCount} oldest records. Size: ${telemetryWriteBuffer.length}/${MAX_BUFFER_SIZE}`);
  }
  telemetryWriteBuffer.push({
    driver_id,
    order_display_id: order_display_id || null,
    location: {
      type: 'Point',
      coordinates: [parseFloat(longitude), parseFloat(latitude)]
    },
    speed_kmh: speed || 0,
    bearing_deg: bearing || 0,
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
        JSON.stringify({ latitude, longitude, speed, bearing, updated_at: new Date(serverNow) }),
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
      order_display_id,
      latitude,
      longitude,
      speed,
      bearing,
      timestamp: new Date(serverNow)
    }
  });

  if (order_display_id && trackingSubscriptions.has(order_display_id)) {
    const clients = trackingSubscriptions.get(order_display_id);
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
}

/**
 * Periodically dumps the aggregated batch matrix logs into MongoDB Atlas
 */
async function flushTelemetryBuffer() {
  if (currentFlushPromise) {
    return currentFlushPromise;
  }

  if (telemetryWriteBuffer.length === 0) {
    flushBackoffMs = 1000;
    return;
  }

  if (!getMongoDb()) {
    logger.error('[TRUXIFY STORAGE WARN] MongoDB is not initialized or disconnected. Retaining telemetry logs in memory buffer.');
    return;
  }

  currentFlushPromise = (async () => {
    const recordsToFlush = [...telemetryWriteBuffer];
    telemetryWriteBuffer = [];

    logger.info(`[TRUXIFY BATCH CONTROL] Committing bulk cluster of ${recordsToFlush.length} spatial rows to MongoDB...`);

    try {
      const collection = getMongoDb().collection('live_gps_pings');
      await collection.insertMany(recordsToFlush, { ordered: false });
      logger.info(`[TRUXIFY DB SUCCESS] Successfully flushed ${recordsToFlush.length} records to MongoDB clusters.`);
      flushBackoffMs = 1000;
    } catch (err) {
      logger.error(`[TRUXIFY RETRY LOGIC] Bulk insert failed (backoff: ${flushBackoffMs}ms):`, err.message);

      const isValidationError = err.code === 121 || err.message.includes('Document failed validation');

      if (isValidationError) {
        logger.error(`[TRUXIFY FATAL DATA DROP] Discarding malformed tracking block payloads to prevent infinite loop memory bloat.`);
      } else {
        flushBackoffMs = Math.min(flushBackoffMs * 2, 60000);

        const spaceAvailable = Math.max(0, MAX_BUFFER_SIZE - telemetryWriteBuffer.length);
        const recordsToKeep = recordsToFlush.slice(-spaceAvailable);
        const droppedCount = recordsToFlush.length - recordsToKeep.length;
        if (droppedCount > 0) {
          logger.warn(`[TRUXIFY BUFFER DROP] Buffer full: dropped ${droppedCount} oldest records from retry batch.`);
        }
        telemetryWriteBuffer = [...recordsToKeep, ...telemetryWriteBuffer];
      }
    } finally {
      currentFlushPromise = null;
    }
  })();

  return currentFlushPromise;
}

function monitorBufferSize() {
  const usagePct = telemetryWriteBuffer.length / MAX_BUFFER_SIZE;
  if (usagePct >= BUFFER_CRIT_THRESHOLD) {
    logger.warn(
      `[TRUXIFY BUFFER MONITOR] CRITICAL: Buffer at ${(usagePct * 100).toFixed(0)}% ` +
      `(${telemetryWriteBuffer.length}/${MAX_BUFFER_SIZE})`
    );
  } else if (usagePct >= BUFFER_WARN_THRESHOLD) {
    logger.warn(
      `[TRUXIFY BUFFER MONITOR] WARNING: Buffer at ${(usagePct * 100).toFixed(0)}% ` +
      `(${telemetryWriteBuffer.length}/${MAX_BUFFER_SIZE})`
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

function initTelemetryScheduler() {
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
      logger.warn(`[TRUXIFY SHUTDOWN] MongoDB not available after waiting. ${dataLoss} telemetry records will be lost.`);
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
