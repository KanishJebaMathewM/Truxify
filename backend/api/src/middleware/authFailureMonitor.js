import logger from './logger.js';

const failures = new Map();

const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 60_000;

export default function authFailureMonitor(req, res, next) {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  if (
    process.env.NODE_ENV === 'production' &&
    process.env.AUTH_FAILURE_MONITOR_ENABLED === 'false'
  ) {
    return next();
  }

  res.on('finish', () => {
    if (res.statusCode !== 401 && res.statusCode !== 403) {
      return;
    }

    const thresholdRaw = Number(
      process.env.AUTH_FAILURE_THRESHOLD || DEFAULT_THRESHOLD
    );
    // Clamp so a misconfigured env (0, negative, NaN) cannot disable the
    // monitor or make every failure reset the window.
    const threshold = Number.isFinite(thresholdRaw) && thresholdRaw > 0
      ? Math.floor(thresholdRaw)
      : DEFAULT_THRESHOLD;

    const windowMsRaw = Number(
      process.env.AUTH_FAILURE_WINDOW_MS || DEFAULT_WINDOW_MS
    );
    const windowMs = Number.isFinite(windowMsRaw) && windowMsRaw >= 1000
      ? windowMsRaw
      : DEFAULT_WINDOW_MS;

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
          requestId: req.requestId || req.id,
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