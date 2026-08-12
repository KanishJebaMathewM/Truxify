import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import logger from './logger.js';

export const correlationContext = new AsyncLocalStorage();

const SAFE_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function correlationIdMiddleware(req, res, next) {
  const header = req.headers['x-correlation-id'];
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
