import { WebSocketServer } from 'ws';
import { mongoDb, redisClient, firebaseAdmin, supabase } from '../config/db.js';
import jwt from 'jsonwebtoken';

// In-memory mapping of active client subscriptions
const trackingSubscriptions = new Map();

// =====================================================================
// EXTRA STORAGE & BUFFER CONFIGURATIONS (#269)
// =====================================================================
const MAX_BUFFER_SIZE = 5000;
const BUFFER_WARN_THRESHOLD = 0.5;
const BUFFER_CRIT_THRESHOLD = 0.8;
const BUFFER_MONITOR_INTERVAL_MS = 30000;
let telemetryWriteBuffer = [];
const BUFFER_FLUSH_INTERVAL_MS = 20000;
let flushBackoffMs = 1000;
let isSchedulerActive = false;
let telemetryFlushTimeout = null;
let wsServer = null;
let wsHeartbeatInterval = null;
let telemetryMonitorInterval = null;

const WS_UPGRADE_RATE_LIMIT = 5;
const WS_UPGRADE_RATE_WINDOW_SECONDS = 60;

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
    console.error('Redis WebSocket upgrade rate limit error:', err.message);
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
      console.log(`🔓 WS Auth bypassed for driver: ${ws.driverId}`);
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
        console.log(`✅ WS Authenticated user: ${ws.user.id}`);
      } catch (e) {
        console.error('WS Auth failed:', e.message);
        ws.close(4001, 'Unauthorized: Invalid token');
        return;
      }
    }

    console.log('🔌 New WebSocket connection established on /ws/tracking');
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      handleTrackingMessage(ws, message);
    });

    ws.on('close', () => {
      console.log('🔌 WebSocket connection closed.');
      removeClientFromAllSubscriptions(ws);
    });

    ws.on('error', (err) => {
      console.error('🔌 WebSocket client error:', err.message);
      removeClientFromAllSubscriptions(ws);
    });
  });

  wsHeartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log('🔌 Terminating unresponsive WebSocket client.');
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

  console.log('🚀 WebSocket tracking router initialized.');
}

export async function handleTrackingMessage(ws, message) {
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
        handleUnsubscribe(ws, data);
        break;

      default:
        ws.send(JSON.stringify({ warning: `Unknown event type: ${event}` }));
    }
  } catch (err) {
    console.error('WS Message parsing error:', err.message);
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

  if (!latitude || !longitude) {
    return ws.send(JSON.stringify({ error: 'Missing mandatory tracking parameters (lat, lng).' }));
  }

  // 🛡️ ADJUSTMENT 2: Device Timestamp Strict Validation
  let currentPingTime = new Date();
  if (device_timestamp) {
    const parsedEpoch = Date.parse(device_timestamp);
    if (isNaN(parsedEpoch)) {
      console.error(`[TRUXIFY VALIDATION ERROR] Malformed device_timestamp received from driver: ${driver_id}. Falling back to server time.`);
      // Prevent poisoning the Redis sequence cache with an incorrect epoch layout
    } else {
      currentPingTime = new Date(parsedEpoch);
    }
  }
  const incomingEpoch = currentPingTime.getTime();

  // 🛡️ 1. IDEMPOTENCY GATE & OUT-OF-ORDER SEQUENCER
  if (redisClient) {
    try {
      const seqKey = `driver:sequence:${driver_id}`;
      const lastRecordedEpochStr = await redisClient.get(seqKey);
      
      if (lastRecordedEpochStr) {
        const lastRecordedEpoch = parseInt(lastRecordedEpochStr, 10);
        
        if (incomingEpoch <= lastRecordedEpoch) {
          console.warn(`[TRUXIFY SEQUENCE CONTROL] Out-of-order telemetry dropped for Driver: ${driver_id}. Stale jitter detected.`);
          return;
        }
      }
      
      await redisClient.set(seqKey, incomingEpoch.toString(), 'EX', 86400); 
    } catch (err) {
      console.error('Redis sequence verification cache error:', err.message);
    }
  }

  // Buffer write with capacity limit
  if (telemetryWriteBuffer.length >= MAX_BUFFER_SIZE) {
    const dropCount = Math.floor(MAX_BUFFER_SIZE * 0.1);
    telemetryWriteBuffer.splice(0, dropCount);
    console.warn(`[TRUXIFY BUFFER WARN] Telemetry buffer full: dropped ${dropCount} oldest records. Size: ${telemetryWriteBuffer.length}/${MAX_BUFFER_SIZE}`);
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
    pinged_at: currentPingTime,
    buffered_at: new Date()
  });

  // Buffer usage monitoring
  const usagePct = (telemetryWriteBuffer.length / MAX_BUFFER_SIZE) * 100;
  if (usagePct >= 80) {
    console.warn(`[TRUXIFY BUFFER CRITICAL] Buffer at ${usagePct.toFixed(0)}% capacity (${telemetryWriteBuffer.length}/${MAX_BUFFER_SIZE})`);
  } else if (usagePct >= 50 && usagePct < 60) {
    console.warn(`[TRUXIFY BUFFER WARN] Buffer at ${usagePct.toFixed(0)}% capacity (${telemetryWriteBuffer.length}/${MAX_BUFFER_SIZE})`);
  }

  if (redisClient) {
    try {
      const redisKey = `driver:location:${driver_id}`;
      await redisClient.set(
        redisKey,
        JSON.stringify({ latitude, longitude, speed, bearing, updated_at: currentPingTime }),
        'EX',
        120
      );
    } catch (err) {
      console.error('Redis cache telemetry error:', err.message);
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
      timestamp: currentPingTime
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
  if (telemetryWriteBuffer.length === 0) {
    flushBackoffMs = 1000;
    return;
  }

  // 🛡️ ADJUSTMENT 1: Move database client check to the absolute top to avoid buffer data loss
  if (!mongoDb) {
    console.error('[TRUXIFY STORAGE WARN] MongoDB is not initialized or disconnected. Retaining telemetry logs in memory buffer.');
    return; // Fast return without clearing the active local telemetryWriteBuffer
  }

  // Now it's perfectly safe to slice and isolate the buffer arrays
  const recordsToFlush = [...telemetryWriteBuffer];
  telemetryWriteBuffer = [];

  console.log(`[TRUXIFY BATCH CONTROL] Committing bulk cluster of ${recordsToFlush.length} spatial rows to MongoDB...`);

  try {
    const collection = mongoDb.collection('live_gps_pings');
    await collection.insertMany(recordsToFlush, { ordered: false });
    console.log(`[TRUXIFY DB SUCCESS] Successfully flushed ${recordsToFlush.length} records to MongoDB clusters.`);
    flushBackoffMs = 1000;
  } catch (err) {
    console.error(`[TRUXIFY RETRY LOGIC] Bulk insert failed (backoff: ${flushBackoffMs}ms):`, err.message);

    // 🛡️ ADJUSTMENT 3: Refined Retry Strategy to prevent memory bloat
    // Check if the error code/message relates to a persistent schema validation breakdown or structural malformation
    const isValidationError = err.code === 121 || err.message.includes('Document failed validation');

    if (isValidationError) {
      console.error(`[TRUXIFY FATAL DATA DROP] Discarding malformed tracking block payloads to prevent infinite loop memory bloat.`);
      // Do NOT re-queue these records since they will fail indefinitely and consume stack space
    } else {
      // Exponential backoff with 60s cap
      flushBackoffMs = Math.min(flushBackoffMs * 2, 60000);

      // Capacity-aware re-queue: only keep as many as there's space for
      const spaceAvailable = Math.max(0, MAX_BUFFER_SIZE - telemetryWriteBuffer.length);
      const recordsToKeep = recordsToFlush.slice(-spaceAvailable);
      const droppedCount = recordsToFlush.length - recordsToKeep.length;
      if (droppedCount > 0) {
        console.warn(`[TRUXIFY BUFFER DROP] Buffer full: dropped ${droppedCount} oldest records from retry batch.`);
      }
      telemetryWriteBuffer = [...recordsToKeep, ...telemetryWriteBuffer];
    }
  }
}

function monitorBufferSize() {
  const usagePct = telemetryWriteBuffer.length / MAX_BUFFER_SIZE;
  if (usagePct >= BUFFER_CRIT_THRESHOLD) {
    console.warn(
      `[TRUXIFY BUFFER MONITOR] CRITICAL: Buffer at ${(usagePct * 100).toFixed(0)}% ` +
      `(${telemetryWriteBuffer.length}/${MAX_BUFFER_SIZE})`
    );
  } else if (usagePct >= BUFFER_WARN_THRESHOLD) {
    console.warn(
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

  try {
    await flushTelemetryBuffer();
  } catch (err) {
    console.error('[shutdown] Failed to flush telemetry buffer:', err.message);
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
        console.error('[shutdown] Failed to close WebSocket client:', err.message);
      }
    });

    serverToClose.close((err) => {
      if (err) {
        console.error('[shutdown] WebSocket server close error:', err.message);
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
  console.log(`🔌 Client subscribed to telemetry updates for: "${targetId}"`);
  ws.send(JSON.stringify({ status: 'subscribed', target: targetId }));
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

function handleUnsubscribe(ws, data) {
  const { order_display_id, driver_id } = data;
  const targetId = order_display_id || driver_id;

  if (targetId && trackingSubscriptions.has(targetId)) {
    trackingSubscriptions.get(targetId).delete(ws);
    console.log(`🔌 Client unsubscribed from updates for: "${targetId}"`);
    ws.send(JSON.stringify({ status: 'unsubscribed', target: targetId }));
  }
}

function removeClientFromAllSubscriptions(ws) {
  trackingSubscriptions.forEach((clients, key) => {
    if (clients.has(ws)) {
      clients.delete(ws);
      console.log(`🔌 Removed socket subscription from "${key}" due to disconnect.`);
    }
    if (clients.size === 0) {
      trackingSubscriptions.delete(key);
    }
  });
}

export const __testing = {
  resetTrackingSubscriptions() {
    trackingSubscriptions.clear();
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
};
