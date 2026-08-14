import logger from './logger.js';
import EventEmitter from 'events';

// ==========================================
// 1. CONFIGURATION & STATE STORAGE
// ==========================================

const failures = new Map();
const blockedIPs = new Map();
const allowlistedIPs = new Set(['127.0.0.1', '::1']);

const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_BAN_DURATION_MS = 15 * 60_000; // 15 minutes
const GC_INTERVAL_MS = 5 * 60_000; // Garbage collection every 5 min

export const securityEvents = new EventEmitter();

// Route-specific sensitive threshold overrides
const ROUTE_THRESHOLDS = new Map([
  ['/api/auth/login', 3],
  ['/api/auth/signup', 5],
  ['/api/auth/reset-password', 3],
  ['/api/admin', 2]
]);

// ==========================================
// 2. HELPER & UTILITY FUNCTIONS
// ==========================================

function extractClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map((ip) => ip.trim());
    return ips[0];
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getThresholdForPath(path) {
  for (const [route, limit] of ROUTE_THRESHOLDS.entries()) {
    if (path.startsWith(route)) return limit;
  }
  return Number(process.env.AUTH_FAILURE_THRESHOLD || DEFAULT_THRESHOLD);
}

function cleanExpiredRecords() {
  const now = Date.now();
  const windowMs = Number(process.env.AUTH_FAILURE_WINDOW_MS || DEFAULT_WINDOW_MS);

  // Sweep failures
  for (const [ip, record] of failures.entries()) {
    if (now - record.lastFailure > windowMs) {
      failures.delete(ip);
    }
  }

  // Sweep expired bans
  for (const [ip, unbanTime] of blockedIPs.entries()) {
    if (now >= unbanTime) {
      blockedIPs.delete(ip);
      logger.info({ ip }, '[Security Engine] IP automatic ban lifted');
    }
  }
}

// Periodically clear stale memory entries
const gcTimer = setInterval(cleanExpiredRecords, GC_INTERVAL_MS);
if (gcTimer.unref) gcTimer.unref();

// ==========================================
// 3. ADMIN MANAGEMENT API
// ==========================================

export const SecurityAdmin = {
  blockIP(ip, durationMs = DEFAULT_BAN_DURATION_MS) {
    blockedIPs.set(ip, Date.now() + durationMs);
    failures.delete(ip);
    logger.warn({ ip, durationMs }, '[Security Engine] Manual IP Ban applied');
  },

  unblockIP(ip) {
    blockedIPs.delete(ip);
    failures.delete(ip);
    logger.info({ ip }, '[Security Engine] IP manually unblocked');
  },

  allowlistIP(ip) {
    allowlistedIPs.add(ip);
    blockedIPs.delete(ip);
    failures.delete(ip);
  },

  getMetrics() {
    return {
      trackedIPCount: failures.size,
      blockedIPCount: blockedIPs.size,
      blockedIPs: Array.from(blockedIPs.keys()),
      allowlistedIPs: Array.from(allowlistedIPs)
    };
  }
};

// ==========================================
// 4. CORE MIDDLEWARE ENGINE
// ==========================================

function parseEnvNumber(raw, fallback, { min } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return fallback;
  return n;
}

export default function authFailureMonitor(req, res, next) {
  const ip = extractClientIP(req);

  // Skip checks for allowlisted IPs
  if (allowlistedIPs.has(ip)) {
    return next();
  }

  const now = Date.now();

  // Enforce Active Bans
  if (blockedIPs.has(ip)) {
    const unbanTime = blockedIPs.get(ip);
    if (now < unbanTime) {
      const retryAfterSec = Math.ceil((unbanTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      
      logger.warn(
        { ip, path: req.originalUrl, method: req.method },
        '[Security Engine] Blocked IP attempted access'
      );

      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Your IP has been temporarily locked out due to repeated failed authentication attempts.',
        retryAfterSeconds: retryAfterSec
      });
    } else {
      blockedIPs.delete(ip);
    }
  }

  // Intercept Response Completion
  res.on('finish', () => {
    if (res.statusCode !== 401 && res.statusCode !== 403) {
      // Clear failures on successful auth
      if (res.statusCode >= 200 && res.statusCode < 300 && failures.has(ip)) {
        failures.delete(ip);
      }
      return;
    }

    const windowMs = Number(process.env.AUTH_FAILURE_WINDOW_MS || DEFAULT_WINDOW_MS);
    const banDurationMs = Number(process.env.AUTH_BAN_DURATION_MS || DEFAULT_BAN_DURATION_MS);
    const threshold = getThresholdForPath(req.originalUrl);

    const existing = failures.get(ip);

    if (!existing || now - existing.firstFailure > windowMs) {
      failures.set(ip, {
        count: 1,
        firstFailure: now,
        lastFailure: now,
        attempts: [{ path: req.originalUrl, time: now, status: res.statusCode }]
      });
      return;
    }

    existing.count += 1;
    existing.lastFailure = now;
    existing.attempts.push({ path: req.originalUrl, time: now, status: res.statusCode });

    // Threshold Reached - Trigger Warnings & Auto-Ban
    if (existing.count >= threshold) {
      const isAutoBanEnabled = process.env.ENABLE_AUTO_BAN !== 'false';

      logger.warn(
        {
          ip,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          failureCount: existing.count,
          threshold,
          windowMs,
          autoBanned: isAutoBanEnabled
        },
        'Repeated authentication failures detected'
      );

      securityEvents.emit('authFailureThresholdExceeded', {
        ip,
        count: existing.count,
        path: req.originalUrl,
        timestamp: now
      });

      if (isAutoBanEnabled) {
        blockedIPs.set(ip, now + banDurationMs);
        failures.delete(ip);
        
        logger.error(
          { ip, banDurationMs },
          '[Security Engine] IP automatically banned due to repeated auth breaches'
        );
      }
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

