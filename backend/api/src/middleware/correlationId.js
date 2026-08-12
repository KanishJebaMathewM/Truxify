import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import logger from './logger.js';

export const correlationContext = new AsyncLocalStorage();

const SAFE_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function correlationIdMiddleware(req, res, next) {
  let header = req.headers['x-correlation-id'];

  // A repeated `x-correlation-id` header arrives as an array. Take the first
  // value so a client that legitimately repeats the header keeps its
  // correlation id instead of silently getting a fresh UUID.
  if (Array.isArray(header)) {
    header = header[0];
  }

  const correlationId =
    typeof header === 'string' && SAFE_CORRELATION_ID.test(header.trim())
      ? header.trim()
      : randomUUID();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  logger.debug(
    { event: 'CORRELATION_ID_SET', correlationId, requestId: req.requestId || req.id },
    `Correlation ID ${correlationId} ${header ? 'propagated from client' : 'generated'}`,
  );

  const store = { correlationId };
  correlationContext.run(store, next);
}
