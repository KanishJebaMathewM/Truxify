import { randomUUID } from 'crypto';
import logger from './logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestIdMiddleware(req, res, next) {
  const header = req.headers['x-request-id'];
  let validId = null;
  if (typeof header === 'string') {
    const trimmed = header.trim();
    if (UUID_RE.test(trimmed)) {
      validId = trimmed;
    } else if (trimmed.length > 0 && trimmed.length <= 100 && /^[\w-]+$/.test(trimmed)) {
      validId = trimmed;
    }
  }
  req.requestId = validId || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    });
  });
  next();
}
