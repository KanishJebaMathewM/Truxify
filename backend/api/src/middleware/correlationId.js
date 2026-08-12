import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import logger from './logger.js';

export const correlationContext = new AsyncLocalStorage();

const SAFE_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function correlationIdMiddleware(req, res, next) {
  const headers = req?.headers || {};
  const header = headers['x-correlation-id'] || headers['X-Correlation-ID'];
  // A repeated x-correlation-id header arrives as an array. The multi-value form
  // is ambiguous and must not be trusted, so treat it as invalid and generate a
  // fresh UUID rather than regex-testing any single entry.
  const correlationId =
    !Array.isArray(header) && typeof header === 'string' && SAFE_CORRELATION_ID.test(header.trim())
      ? header.trim()
      : randomUUID();

  if (req) {
    req.correlationId = correlationId;
  }
  if (typeof res?.setHeader === 'function') {
    res.setHeader('X-Correlation-ID', correlationId);
  }

  logger.debug(
    { event: 'CORRELATION_ID_SET', correlationId, requestId: req?.requestId || req?.id },
    `Correlation ID ${correlationId} ${header ? 'propagated from client' : 'generated'}`,
  );

  const store = { correlationId };
  correlationContext.run(store, next);
}
