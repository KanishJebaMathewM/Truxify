import logger from './logger.js';

const failures = new Map();

const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 60_000;

// Upper bound on distinct tracked IPs so a distributed brute-force sweep
// across many source addresses cannot grow this map without limit. When the
// cap is reached the oldest tracked IP is evicted first (Map insertion order).
const MAX_TRACKED_IPS = 10_000;

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

    const threshold = Number(
      process.env.AUTH_FAILURE_THRESHOLD || DEFAULT_THRESHOLD
    );

    const windowMs = Number(
      process.env.AUTH_FAILURE_WINDOW_MS || DEFAULT_WINDOW_MS
    );

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    // Bound the tracked set before inserting a new IP.
    if (!failures.has(ip) && failures.size >= MAX_TRACKED_IPS) {
      const oldest = failures.keys().next().value;
      if (oldest !== undefined) failures.delete(oldest);
    }

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