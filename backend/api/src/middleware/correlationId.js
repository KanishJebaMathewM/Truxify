import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import logger from './logger.js';
// backend/api/src/middleware/correlationId.js

import { randomUUID } from 'crypto';

// Enforce safe character set and length cap matching requestId.js
const SAFE_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Middleware to extract, validate, or generate a secure correlation ID.
 * Updated per issue #10492 to prevent log injection and unbounded header reflection.
 */
export function correlationIdMiddleware(req, res, next) {
  const header = req.headers['x-correlation-id'];
  
  let correlationId;
  if (typeof header === 'string' && SAFE_CORRELATION_ID.test(header.trim())) {
    correlationId = header.trim();
  } else {
    correlationId = randomUUID();
  }

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  next();
}

export default correlationIdMiddleware;
export const correlationContext = new AsyncLocalStorage();

const SAFE_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

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

export function runWithCorrelationId(correlationId, fn) {
  return correlationContext.run({ correlationId }, fn);
}

export function getCorrelationStore() {
  return correlationContext.getStore() ?? {};
}
