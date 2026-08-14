import logger from './logger.js';

const failures = new Map();

const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 60_000;

export default function authFailureMonitor(req, res, next) {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.AUTH_FAILURE_MONITOR_ENABLED !== 'true'
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

// === Spec 4: ===
// === Spec 4: fail-closed when Redis is unreachable ===
export async function checkBoundOrFailClosed(redis, ip, opts = {}) {
  const { maxAttempts = 5, redisTimeoutMs = 250 } = opts;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('redis_timeout')), redisTimeoutMs);
  });
  try {
    const count = await Promise.race([redis.incr(`authfail:${ip}`), timeout]);
    clearTimeout(timer);
    if (Number(count) >= maxAttempts) return { allowed: false, reason: 'banned' };
    return { allowed: true, count: Number(count) };
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err.message === 'redis_timeout') return { allowed: false, reason: 'security_unavailable' };
    throw err;
  }
}

