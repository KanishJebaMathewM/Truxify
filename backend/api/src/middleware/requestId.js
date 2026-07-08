import { randomUUID } from 'crypto';
import logger from './logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestIdMiddleware(req, res, next) {
  const header = req.headers['x-request-id'];
  req.requestId = (typeof header === 'string' && header.trim()) ? header.trim() : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function requestLogger(req, res, next) {
  const start = Date.now();
  const requestedLogLevel = req.headers?.['x-log-level'];
  let reqLogger = logger;
  
  if (requestedLogLevel && ['info', 'warn', 'error', 'debug', 'trace'].includes(requestedLogLevel.toLowerCase())) {
    reqLogger = logger.child({});
    reqLogger.level = requestedLogLevel.toLowerCase();
  }
  
  req.log = reqLogger;

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    reqLogger[level]({
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
