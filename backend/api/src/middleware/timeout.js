import timeout from 'connect-timeout';
import logger from './logger.js';
import { mongoDb } from '../config/db.js';

export const SLOW_REQUEST_THRESHOLD_MS = 10000; // 10 seconds

export const ROUTE_TIMEOUT_OVERRIDES = {
  '/api/ml/vrp': '120s',
  '/api/ml/demand-heatmap': '60s',
  default: '30s'
};

/**
 * Returns the configured timeout duration for a given path.
 * /api/ml/vrp -> 120s
 * /api/ml/demand-heatmap -> 60s
 * All other routes -> 30s
 */
export function getTimeoutForPath(path = '') {
  if (path.startsWith('/api/ml/vrp')) {
    return '120s';
  }
  if (path.startsWith('/api/ml/demand-heatmap') || path.startsWith('/api/demand-heatmap')) {
    return '60s';
  }
  return '30s';
}

/**
 * Creates route-level timeout middleware array with connect-timeout.
 */
export function createTimeoutMiddleware(duration = '30s') {
  return [
    timeout(duration),
    (req, res, next) => {
      if (!req.timedout) next();
    }
  ];
}

export const vrpTimeoutMiddleware = createTimeoutMiddleware('120s');
export const demandHeatmapTimeoutMiddleware = createTimeoutMiddleware('60s');
export const defaultTimeoutMiddleware = createTimeoutMiddleware('30s');

const vrpTimeout = timeout('120s');
const heatmapTimeout = timeout('60s');
const defaultTimeout = timeout('30s');

/**
 * Global timeout middleware:
 * Applies 30s timeout by default, with route overrides:
 * - /api/ml/vrp -> 120s (fleet optimisation)
 * - /api/ml/demand-heatmap -> 60s
 * - all other routes -> 30s
 */
export const timeoutMiddleware = [
  (req, res, next) => {
    // If a per-route timeout was already configured on this request, respect it
    if (req.clearTimeout) {
      return next();
    }
    const path = req.originalUrl || req.path || req.url || '';
    if (path.startsWith('/api/ml/vrp')) {
      return vrpTimeout(req, res, next);
    }
    if (path.startsWith('/api/ml/demand-heatmap') || path.startsWith('/api/demand-heatmap')) {
      return heatmapTimeout(req, res, next);
    }
    return defaultTimeout(req, res, next);
  },
  (req, res, next) => {
    if (!req.timedout) next();
  }
];

/**
 * Persists slow request details to MongoDB `slow_requests` collection.
 */
export async function logSlowRequest(entry, customDb = null) {
  const db = customDb || mongoDb;
  if (!db) {
    logger.warn({ entry }, '[timeout] Slow request (>10s) detected; MongoDB not connected');
    return null;
  }
  try {
    const collection = db.collection('slow_requests');
    const result = await collection.insertOne({
      ...entry,
      timestamp: entry.timestamp || new Date()
    });
    return result;
  } catch (err) {
    logger.error({ err: err.message, entry }, '[timeout] Failed to log slow request to MongoDB slow_requests collection');
    return null;
  }
}

/**
 * Middleware that monitors request duration and logs requests taking >10s to MongoDB slow_requests collection.
 */
export function slowRequestLogger(thresholdMs = SLOW_REQUEST_THRESHOLD_MS) {
  return (req, res, next) => {
    const startTime = Date.now();
    let recorded = false;

    const onComplete = () => {
      if (recorded) return;
      recorded = true;

      const durationMs = Date.now() - startTime;
      if (durationMs > thresholdMs) {
        const entry = {
          url: req.originalUrl || req.url,
          method: req.method,
          statusCode: res.statusCode,
          durationMs,
          timestamp: new Date(),
          timedOut: Boolean(req.timedout),
          ip: req.ip || req.connection?.remoteAddress || null,
          userId: req.user?.id || req.user?.sub || null,
          userAgent: (req.get && req.get('user-agent')) || req.headers?.['user-agent'] || null,
          requestId: req.requestId || (req.headers && req.headers['x-request-id']) || null
        };

        logger.warn(entry, `[timeout] Slow request (>10s): ${req.method} ${entry.url} took ${durationMs}ms`);

        logSlowRequest(entry).catch((err) => {
          logger.error({ err: err.message }, '[timeout] Unexpected error logging slow request');
        });
      }
    };

    res.on('finish', onComplete);
    res.on('close', onComplete);

    next();
  };
}

export const slowRequestLoggerMiddleware = slowRequestLogger(SLOW_REQUEST_THRESHOLD_MS);

/**
 * Creates indexes on `slow_requests` collection in MongoDB.
 */
export function createSlowRequestsCollectionIndexes(db) {
  if (!db) return;
  db.collection('slow_requests').createIndex(
    { timestamp: -1 }
  ).catch(err => logger.error({ err }, 'Failed to create timestamp index on slow_requests'));

  db.collection('slow_requests').createIndex(
    { durationMs: -1 }
  ).catch(err => logger.error({ err }, 'Failed to create durationMs index on slow_requests'));
}

/**
 * Error handling middleware to catch timeout errors and return standardized JSON response:
 * { "error": "REQUEST_TIMEOUT", "message": "Request exceeded the time limit. Please try again.", "retryAfter": 5 }
 */
export function timeoutErrorHandler(err, req, res, next) {
  if (req?.timedout || err?.code === 'ETIMEDOUT' || err?.timeout || err?.status === 503) {
    if (res.headersSent) {
      return next(err);
    }
    logger.warn({ requestId: req?.requestId, path: req?.originalUrl || req?.url }, '[timeout] Request timed out');
    res.set('Retry-After', '5');
    return res.status(503).json({
      error: 'REQUEST_TIMEOUT',
      message: 'Request exceeded the time limit. Please try again.',
      retryAfter: 5
    });
  }
  next(err);
}

export default {
  timeoutMiddleware,
  slowRequestLogger,
  slowRequestLoggerMiddleware,
  timeoutErrorHandler,
  createTimeoutMiddleware,
  vrpTimeoutMiddleware,
  demandHeatmapTimeoutMiddleware,
  defaultTimeoutMiddleware,
  logSlowRequest,
  getTimeoutForPath,
  SLOW_REQUEST_THRESHOLD_MS,
  ROUTE_TIMEOUT_OVERRIDES,
  createSlowRequestsCollectionIndexes
};
