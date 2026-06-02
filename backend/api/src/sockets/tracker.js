import { WebSocketServer } from 'ws';
import { mongoDb, redisClient, firebaseAdmin } from '../config/db.js';

// In-memory mapping of active client subscriptions
const trackingSubscriptions = new Map();

// =====================================================================
// 📦 EXTRA STORAGE & BUFFER CONFIGURATIONS (#269)
// =====================================================================
let telemetryWriteBuffer = [];
const BUFFER_FLUSH_INTERVAL_MS = 20000; 
let isSchedulerActive = false;

/**
 * Initialize WebSockets Server and bind event handlers
 */
export function initWebSocketServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;

    if (pathname === '/ws/tracking') {
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
      ws.driverId = reqUrl.searchParams.get('driver_id') || 'test_driver';
      console.log(`🔓 WS Auth bypassed for driver: ${ws.driverId}`);
    } else {
      if (!token) {
        ws.close(4001, 'Unauthorized: No token provided');
        return;
      }
      try {
        const decoded = await firebaseAdmin.auth().verifyIdToken(token);
        ws.driverId = decoded.uid;
        console.log(`✅ WS Authenticated driver: ${ws.driverId}`);
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

    ws.on('message', async (message) => {
      try {
        const payload = JSON.parse(message.toString());
        const { event, data } = payload;

        if (!event || !data) {
          return ws.send(JSON.stringify({ error: 'Invalid payload format. Must include "event" and "data" keys.' }));
        }

        switch (event) {
          case 'location_ping':
            await handleLocationPing(ws, data);
            break;

          case 'subscribe_tracking':
            handleSubscribe(ws, data);
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

  const interval = setInterval(() => {
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
    clearInterval(interval);
  });

  if (!isSchedulerActive) {
    initTelemetryScheduler();
  }

  console.log('🚀 WebSocket tracking router initialized.');
}

/**
 * Handle incoming GPS coordinate telemetry from a driver app
 */
async function handleLocationPing(ws, data) {
  const { driver_id, order_display_id, latitude, longitude, speed, bearing, device_timestamp } = data;

  if (!driver_id || !latitude || !longitude) {
    return ws.send(JSON.stringify({ error: 'Missing mandatory tracking parameters (driver_id, lat, lng).' }));
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

  // 🛡️ 2. WRITE-BUFFER DEFERMENT (BATCHING)
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
  if (telemetryWriteBuffer.length === 0) return;

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
  } catch (err) {
    console.error('Mongo bulk insert telemetry logs error:', err.message);

    // 🛡️ ADJUSTMENT 3: Refined Retry Strategy to prevent memory bloat
    // Check if the error code/message relates to a persistent schema validation breakdown or structural malformation
    const isValidationError = err.code === 121 || err.message.includes('Document failed validation');

    if (isValidationError) {
      console.error(`[TRUXIFY FATAL DATA DROP] Discarding malformed tracking block payloads to prevent infinite loop memory bloat.`);
      // Do NOT re-queue these records since they will fail indefinitely and consume stack space
    } else {
      console.warn(`[TRUXIFY RETRY LOGIC] Transient cluster error detected. Re-injecting ${recordsToFlush.length} frames back to buffer pool.`);
      // Re-insert frames back into execution pools for transient timeouts/network issues
      telemetryWriteBuffer = [...recordsToFlush, ...telemetryWriteBuffer];
    }
  }
}

function initTelemetryScheduler() {
  isSchedulerActive = true;
  setInterval(async () => {
    await flushTelemetryBuffer();
  }, BUFFER_FLUSH_INTERVAL_MS);
}

function handleSubscribe(ws, data) {
  const { order_display_id, driver_id } = data;
  const targetId = order_display_id || driver_id;

  if (!targetId) {
    return ws.send(JSON.stringify({ error: 'Subscription target (order_display_id or driver_id) is missing.' }));
  }

  if (!trackingSubscriptions.has(targetId)) {
    trackingSubscriptions.set(targetId, new Set());
  }

  trackingSubscriptions.get(targetId).add(ws);
  console.log(`🔌 Client subscribed to telemetry updates for: "${targetId}"`);
  ws.send(JSON.stringify({ status: 'subscribed', target: targetId }));
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
