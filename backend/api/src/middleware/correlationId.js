import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import logger from './logger.js';

export const correlationContext = new AsyncLocalStorage();

const SAFE_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function correlationIdMiddleware(req, res, next) {
  const rawHeader =
    req.headers['x-correlation-id'] ??
    req.headers['X-Correlation-ID'] ??
    req.headers['x-correlation-ID'];
  // Node lowercases header names but other runtimes may not; some clients
  // send duplicate headers which arrive as an array — take the first value.
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const correlationId =
    typeof header === 'string' && SAFE_CORRELATION_ID.test(header.trim())
      ? header.trim()
      : randomUUID();

  req.correlationId = correlationId;
  if (typeof res?.setHeader === 'function') {
    res.setHeader('X-Correlation-ID', correlationId);
  }

  logger.debug(
    { event: 'CORRELATION_ID_SET', correlationId, requestId: req.requestId || req.id },
    `Correlation ID ${correlationId} ${header ? 'propagated from client' : 'generated'}`,
  );

  const store = { correlationId };
  correlationContext.run(store, next);
}

/**
 * Run a function inside a correlation-id context, exposing the id to any
 * nested getCorrelationStore()/correlationContext.getStore() callers.
 */
export function runWithCorrelationId(correlationId, fn) {
  return correlationContext.run({ correlationId }, fn);
}

/**
 * Return the correlation store for the current execution context, or an empty
 * object when no correlation id has been set.
 */
export function getCorrelationStore() {
  return correlationContext.getStore() ?? {};
}
