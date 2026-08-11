import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import logger from './logger.js';

export const correlationContext = new AsyncLocalStorage();

export function correlationIdMiddleware(req, res, next) {
  const header = req.headers['x-correlation-id'];
  const correlationId = (typeof header === 'string' && header.trim()) ? header.trim() : randomUUID();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  logger.debug(
    { event: 'CORRELATION_ID_SET', correlationId, requestId: req.requestId || req.id },
    `Correlation ID ${correlationId} ${header ? 'propagated from client' : 'generated'}`,
  );

  const store = { correlationId };
  correlationContext.run(store, next);
}
