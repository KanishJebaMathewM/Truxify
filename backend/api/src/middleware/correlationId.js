// backend/api/src/middleware/correlationId.js
import { randomUUID } from 'crypto';
import axios from 'axios';
import logger from './logger.js';
import {
  correlationContext,
  getCorrelationId,
  getCorrelationStore,
} from '../lib/correlationContext.js';

export { correlationContext, getCorrelationId, getCorrelationStore };

// Safe correlation ID format to prevent header injection & unbound header reflection
const SAFE_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Runs a callback within an asynchronous correlation context.
 * @param {string} correlationId
 * @param {Function} callback
 * @returns {*}
 */
export function runWithCorrelationId(correlationId, callback) {
  const safeId =
    typeof correlationId === 'string' && SAFE_CORRELATION_ID.test(correlationId.trim())
      ? correlationId.trim()
      : correlationId;
  return correlationContext.run({ correlationId: safeId }, callback);
}

/**
 * Express middleware to generate or forward X-Correlation-ID header,
 * attach to req.correlationId, set response header, and run in async context.
 */
export function correlationIdMiddleware(req, res, next) {
  const rawHeader =
    req.headers?.['x-correlation-id'] ??
    req.headers?.['X-Correlation-ID'] ??
    req.headers?.['x-correlation-ID'];

  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  const isPropagated =
    typeof header === 'string' && SAFE_CORRELATION_ID.test(header.trim());

  const correlationId = isPropagated ? header.trim() : randomUUID();

  if (req) {
    req.correlationId = correlationId;
  }

  if (res && typeof res.setHeader === 'function') {
    res.setHeader('X-Correlation-ID', correlationId);
  }

  if (res?.locals) {
    res.locals.correlationId = correlationId;
  }

  if (logger && typeof logger.debug === 'function') {
    logger.debug(
      {
        event: 'CORRELATION_ID_SET',
        correlationId,
        requestId: req?.requestId || req?.id,
      },
      `Correlation ID ${correlationId} ${
        isPropagated ? 'propagated from client' : 'generated'
      }`,
    );
  }

  return correlationContext.run({ correlationId }, next);
}

/**
 * Request/response logging middleware.
 * Logs method, path, status code, duration ms, and correlationId on every response finish.
 */
export function requestLoggingMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const statusCode = res.statusCode;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    const correlationId = req.correlationId || getCorrelationId();

    if (logger && typeof logger[level] === 'function') {
      logger[level]('Request completed', {
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode,
        durationMs,
        correlationId,
      });
    }
  });

  next();
}

/**
 * Helper to construct headers for outgoing requests (including FastAPI calls)
 * with the active X-Correlation-ID attached.
 * @param {Object} [extraHeaders={}]
 * @returns {Object}
 */
export function getFastApiHeaders(extraHeaders = {}) {
  const correlationId = getCorrelationId();
  return {
    'Content-Type': 'application/json',
    ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
    ...extraHeaders,
  };
}

// Automatically configure Axios request interceptor so all outgoing calls
// (such as calls to FastAPI / ML engine) forward the X-Correlation-ID header.
if (axios && axios.interceptors && axios.interceptors.request) {
  axios.interceptors.request.use((config) => {
    const correlationId = getCorrelationId();
    if (correlationId) {
      config.headers = config.headers || {};
      if (!config.headers['X-Correlation-ID'] && !config.headers['x-correlation-id']) {
        config.headers['X-Correlation-ID'] = correlationId;
      }
    }
    return config;
  });
}

export default correlationIdMiddleware;
