import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export const correlationContext = new AsyncLocalStorage();

export function correlationIdMiddleware(req, res, next) {
  const header = req.headers['x-correlation-id'];
  const correlationId = (typeof header === 'string' && header.trim()) ? header.trim() : randomUUID();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  const store = { correlationId };
  correlationContext.run(store, next);
}
