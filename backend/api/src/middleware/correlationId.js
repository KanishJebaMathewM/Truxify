import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import logger from './logger.js';

// Enforce safe character set and length cap matching requestId.js
const SAFE_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const correlationContext = new AsyncLocalStorage();

/**
 * Retrieves the current correlation store context.
 * @returns {Object} Current store containing correlationId.
 */
export function getCorrelationStore() {
  return correlationContext.getStore() ?? {};
}

/**
 * Runs a callback function within an asynchronous correlation ID context.
 * @param {string} correlationId - Unique request tracing ID.
 * @param {Function} fn - Function to execute within context.
 * @returns {any} Result of the callback execution.
 */
export function runWithCorrelationId(correlationId, fn) {
  return correlationContext.run({ correlationId }, fn);
}

/**
 * Express middleware to attach or generate a correlation ID for request tracing.
 */
export function correlationIdMiddleware(req, res, next) {
  const headers = req?.headers || {};
  const rawHeader =
    headers['x-correlation-id'] ??
    headers['X-Correlation-ID'] ??
    headers['x-correlation-ID'];

  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  const isPropagated =
    typeof header === 'string' && SAFE_CORRELATION_ID.test(header.trim());

  const correlationId = isPropagated ? header.trim() : randomUUID();

  if (req) {
    req.correlationId = correlationId;
  }

  if (typeof res?.setHeader === 'function') {
    res.setHeader('X-Correlation-ID', correlationId);
  }

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

  const store = { correlationId };
  correlationContext.run(store, next);
}

export default correlationIdMiddleware;
