/**
 * Request Context & WebSocket Heartbeat Management
 * 
 * Manages request context isolation using AsyncLocalStorage for distributed tracing 
 * and handles WebSocket connection health/heartbeat logging with structured logging.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import logger from '../middleware/logger.js';

const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Express middleware to initialize request context and assign a unique requestId.
 */
export function requestContextMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || req.headers['x-correlation-id'] || randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  const store = {
    requestId,
    method: req.method,
    url: req.originalUrl || req.url,
  };

  asyncLocalStorage.run(store, () => {
    next();
  });
}

/**
 * Retrieves the current request context store.
 */
export function getRequestContext() {
  return asyncLocalStorage.getStore();
}

/**
 * Retrieves the current request ID if available.
 */
export function getCurrentRequestId() {
  const store = getRequestContext();
  return store?.requestId || null;
}

/**
 * WebSocket Heartbeat Handler
 * 
 * Monitors and logs WebSocket connection liveness pings/heartbeats 
 * using structured logging for production observability.
 */
export function handleWebSocketHeartbeat(ws, data) {
  try {
    const clientId = ws?.id || ws?.clientId || 'unknown';
    const timestamp = new Date().toISOString();

    // Replaced console.log with structured logger call
    logger.info(
      {
        event: 'WS_HEARTBEAT',
        clientId,
        timestamp,
        readyState: ws?.readyState,
      },
      'WebSocket heartbeat received'
    );

    // Optional: Respond to heartbeat / ping if connection is active
    if (ws && typeof ws.send === 'function' && ws.readyState === 1) {
      ws.send(JSON.stringify({ event: 'WS_HEARTBEAT_ACK', timestamp }));
    }
  } catch (err) {
    logger.error(
      {
        event: 'WS_HEARTBEAT_ERROR',
        error: err?.message || err,
      },
      'Error handling WebSocket heartbeat'
    );
  }
}

export default {
  requestContextMiddleware,
  getRequestContext,
  getCurrentRequestId,
  handleWebSocketHeartbeat,
};
