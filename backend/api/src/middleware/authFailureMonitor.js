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

