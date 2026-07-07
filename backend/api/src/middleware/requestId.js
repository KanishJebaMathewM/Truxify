import { randomUUID } from 'crypto';
import logger from './logger.js';

export function requestIdMiddleware(req, res, next) {
  req.requestId = req.headers['x-request-id'] || randomUUID();
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

export function addTracingHeaders(req, res, next) {
  res.setHeader('X-Trace-Id', req.requestId);
  res.setHeader('X-Span-Id', randomUUID().slice(0, 8));
  if (req.user?.id) {
    res.setHeader('X-User-Id', req.user.id.slice(0, 8));
  }
  next();
}
