import rateLimit, { MemoryStore } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '../config/db.js';
import logger from './logger.js';

function isRedisReady() {
  return redisClient && redisClient.status === 'ready';
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

function buildStore(prefix) {
  return new DeferredRedisStore(prefix);
}

/**
 * Generates a rate-limit key from the actual TCP connection address instead of
 * req.ip (which trusts the client-controlled X-Forwarded-For header). This
 * prevents attackers from bypassing rate limits by rotating the header value.
 */
export function safeIpKeyGenerator(req) {
  return req.socket?.remoteAddress
    || req.connection?.remoteAddress
    || 'unknown';
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
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: buildStore('rl:global:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
  skip: (req) => req.path === '/health' || req.path.startsWith('/health/'),
});

// Per-user limiter, applied in the route chains immediately after the
// authenticate middleware so req.user is populated and each user gets an
// independent bucket regardless of shared IPs.
export const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  store: buildStore('rl:user:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

export const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: buildStore('rl:health:'),
  message: { error: 'Rate limit exceeded', retryAfter: 60 },
});

export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: buildStore('rl:auth:'),
  message: { error: 'Rate limit exceeded', retryAfter: 3600 },
});

export const bidLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  store: buildStore('rl:bid:'),
  message: { error: 'Rate limit exceeded', retryAfter: 60 },
});

export const deviceLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user?.id) return `user:${req.user.id}`;
    if (req.user?.uid) return `uid:${req.user.uid}`;
    return safeIpKeyGenerator(req);
  },
  store: buildStore('rl:device:'),
  message: { error: 'Rate limit exceeded', retryAfter: 600 },
});

export const __testing = { DeferredRedisStore, isRedisReady };
