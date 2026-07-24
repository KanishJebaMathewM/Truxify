import rateLimit, { MemoryStore } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '../config/db.js';
import logger from './logger.js';

function isSuspiciousForwardedHeader(header) {
  if (!header || typeof header !== 'string') return false;

  // Excessively long headers may indicate spoofing attempts.
  if (header.length > 512) return true;

  const parts = header.split(',').map((ip) => ip.trim());

  // Reject obviously malformed values.
  return parts.some((ip) => ip.length === 0 || ip.includes('\n') || ip.includes('\r'));
}

function isRedisReady() {
  return !!(
    redisClient?.status === 'ready' &&
    redisClient?.isOpen
  );
}

/**
 * Store wrapper that defers the Redis/memory decision to request time.
 *
 * The limiters are constructed while this module is first imported, which
 * happens before the ioredis client has finished connecting. Picking the
 * store eagerly therefore always saw a non-ready client and pinned every
 * limiter to the in-memory store for the life of the process. This wrapper
 * serves requests from an in-memory fallback until Redis becomes ready, then
 * promotes itself to a RedisStore so counters are shared across instances.
 */
class DeferredRedisStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.options = null;
    this.memoryStore = new MemoryStore();
    this.redisStore = null;
    this.redisInitFailed = false;
  }

  init(options) {
    this.options = options;
    this.memoryStore.init(options);
  }

  activeStore() {
    if (this.redisStore) return this.redisStore;
    if (this.redisInitFailed || !isRedisReady()) return this.memoryStore;

    try {
      const store = new RedisStore({
        prefix: this.prefix,
        sendCommand: (command, ...args) => redisClient.call(command, ...args),
      });
      store.init(this.options);
      this.redisStore = store;
      logger.info(`Rate limiter "${this.prefix}" now backed by Redis.`);
      return store;
    } catch (err) {
      this.redisInitFailed = true;
      logger.error({ err }, `Failed to initialise Redis rate limiter store "${this.prefix}". Using in-memory fallback.`);
      return this.memoryStore;
    }
  }

  increment(key) {
    return this.activeStore().increment(key);
  }

  decrement(key) {
    return this.activeStore().decrement(key);
  }

  resetKey(key) {
    return this.activeStore().resetKey(key);
  }

  resetAll() {
    return this.activeStore().resetAll?.();
  }

  get(key) {
    return this.activeStore().get?.(key);
  }
}

/**
 * Generates a rate-limit key from the proxy-resolved IP address.
 *
 * Express's trust-proxy setting (1 hop) resolves X-Forwarded-For to req.ip.
 * Using req.socket.remoteAddress directly would see the load balancer / proxy
 * IP instead of the real client, collapsing all users behind the same proxy
 * into one rate-limit bucket.
 */
export function safeIpKeyGenerator(req) {
  const forwarded = req.headers?.['x-forwarded-for'];

  if (isSuspiciousForwardedHeader(forwarded)) {
    logger.warn(
      {
        requestId: req.requestId,
        header: forwarded,
        socketIp: req.socket?.remoteAddress,
      },
      'Suspicious X-Forwarded-For header detected'
    );
    let ip = req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    if (typeof ip === 'string') {
      if (ip.includes(',')) ip = ip.split(',')[0].trim();
      ip = ip.replace(/^::ffff:/, '');
      if (ip === '::1') ip = '127.0.0.1';
    }
    return ip;
  }

  let ip =
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    'unknown';
  return ip;
}

/**
 * Keys a limiter by the authenticated principal, falling back to the client IP
 * for unauthenticated requests. Used wherever req.user is available so that
 * users sharing a public IP (e.g. mobile clients behind carrier-grade NAT) are
 * limited independently rather than against one shared bucket.
 */
export function userKeyGenerator(req) {
  if (req.user?.id) return `user:${req.user.id}`;
  if (req.user?.uid) return `uid:${req.user.uid}`;
  return safeIpKeyGenerator(req);
}

// Coarse, pre-auth IP limiter. It runs before authentication, so it can only
// key by IP; kept generous so that legitimate users sharing a NAT'd IP are not
// throttled by each other. Per-user fairness is enforced by userLimiter once
// the request is authenticated.
// Configurable rate limiter settings (defaults preserve existing behaviour)
const GLOBAL_WINDOW_MS = Number(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const GLOBAL_MAX_REQUESTS = Number(process.env.GLOBAL_RATE_LIMIT_MAX_REQUESTS) || 1000;

const USER_WINDOW_MS = Number(process.env.USER_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const USER_MAX_REQUESTS = Number(process.env.USER_RATE_LIMIT_MAX_REQUESTS) || 300;

const HEALTH_WINDOW_MS = Number(process.env.HEALTH_RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const HEALTH_MAX_REQUESTS = Number(process.env.HEALTH_RATE_LIMIT_MAX_REQUESTS) || 60;

const AUTH_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000;
const AUTH_MAX_REQUESTS = Number(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS) || 10;

const BID_WINDOW_MS = Number(process.env.BID_RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const BID_MAX_REQUESTS = Number(process.env.BID_RATE_LIMIT_MAX_REQUESTS) || 30;

const DEVICE_WINDOW_MS = Number(process.env.DEVICE_RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000;
const DEVICE_MAX_REQUESTS = Number(process.env.DEVICE_RATE_LIMIT_MAX_REQUESTS) || 10;

export const globalLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  max: GLOBAL_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: createStore('rl:global:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
  skip: (req) => req.path === '/health' || req.path.startsWith('/health/'),
});

// Per-user limiter, applied in the route chains immediately after the
// authenticate middleware so req.user is populated and each user gets an
// independent bucket regardless of shared IPs.
export const userLimiter = rateLimit({
  windowMs: USER_WINDOW_MS,
  max: USER_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  store: createStore('rl:user:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

export const healthLimiter = rateLimit({
  windowMs: HEALTH_WINDOW_MS,
  max: HEALTH_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: createStore('rl:health:'),
  message: { error: 'Rate limit exceeded', retryAfter: 60 },
});

export const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: createStore('rl:auth:'),

  handler: (req, res) => {
    logger.warn(
      {
        requestId: req.requestId,
        ip: safeIpKeyGenerator(req),
        path: req.originalUrl,
        method: req.method,
        userAgent: req.get('user-agent'),
      },
      'Authentication rate limit exceeded'
    );

    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil(AUTH_WINDOW_MS / 1000),
    });
  },
});

export const bidLimiter = rateLimit({
  windowMs: BID_WINDOW_MS,
  max: BID_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  store: createStore('rl:bid:'),
  message: { error: 'Rate limit exceeded', retryAfter: 60 },
});

export const deviceLimiter = rateLimit({
  windowMs: DEVICE_WINDOW_MS,
  max: DEVICE_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user?.id) return `user:${req.user.id}`;
    if (req.user?.uid) return `uid:${req.user.uid}`;
    return safeIpKeyGenerator(req);
  },
  store: createStore('rl:device:'),
  message: { error: 'Rate limit exceeded', retryAfter: 600 },
});

// Dedicated limiter for administrative endpoints. Admin operations perform
// privileged actions (dashboard queries, cache invalidation, cross-user
// ticket access) and deserve stricter limits than the general user limiter.
// Keyed by authenticated user ID so each admin gets an independent bucket.
const adminWindowMs = Number(process.env.ADMIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const adminMaxRequests = Number(process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS) || 50;

export const adminRateLimiter = rateLimit({
  windowMs: adminWindowMs,
  max: adminMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  store: createStore('rl:admin:'),
  message: { error: 'Rate limit exceeded', retryAfter: Math.ceil(adminWindowMs / 1000) },
});

/**
 * Factory that creates a DeferredRedisStore — used by both the built-in
 * limiters in this module and by route-level limiters (orderRoutes,
 * driverRoutes) that need Redis-backed shared state across instances.
 */
export function createStore(prefix) {
  return new DeferredRedisStore(prefix);
}

export const __testing = { DeferredRedisStore, isRedisReady };
