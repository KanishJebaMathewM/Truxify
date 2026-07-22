import { randomUUID } from 'crypto';
import logger from './logger.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.requestId =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
      ? incoming
      : randomUUID();

  res.locals.requestId = req.requestId;

  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function requestLogger(req, res, next) {
  const start = Date.now();
  const requestedLogLevel = req.headers?.['x-log-level'];
  const childBindings = {
    requestId: req.requestId,
  };

  if (req.correlationId) {
    childBindings.correlationId = req.correlationId;
  }

  const reqLogger = logger.child(childBindings);

  if (
    requestedLogLevel &&
    ['trace', 'debug', 'info', 'warn', 'error'].includes(requestedLogLevel.toLowerCase())
  ) {
  let reqLogger = logger;
  
  if (process.env.NODE_ENV !== 'production' && requestedLogLevel && ['info', 'warn', 'error', 'debug', 'trace'].includes(requestedLogLevel.toLowerCase())) {
    reqLogger = logger.child({});
    reqLogger.level = requestedLogLevel.toLowerCase();
  }

  req.log = reqLogger;

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    reqLogger[level]({
      requestId: req.requestId,
      correlationId: req.correlationId,
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
