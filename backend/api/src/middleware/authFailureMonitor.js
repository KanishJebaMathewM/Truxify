import logger from './logger.js';

const failures = new Map();

const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 60_000;

export default function authFailureMonitor(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return next();
  }

  res.on('finish', () => {
    if (res.statusCode !== 401 && res.statusCode !== 403) {
      return;
    }

    const threshold = Number(
      process.env.AUTH_FAILURE_THRESHOLD || DEFAULT_THRESHOLD
    );

    const windowMs = Number(
      process.env.AUTH_FAILURE_WINDOW_MS || DEFAULT_WINDOW_MS
    );

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    const existing = failures.get(ip);

    if (!existing || now - existing.firstFailure > windowMs) {
      failures.set(ip, {
        count: 1,
        firstFailure: now,
      });
      return;
    }

    existing.count += 1;

    if (existing.count >= threshold) {
      logger.warn(
        {
          ip,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          failureCount: existing.count,
          windowMs,
        },
        'Repeated authentication failures detected'
      );
    }
  });

  next();
}