import rateLimit, { MemoryStore } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import * as Sentry from "@sentry/node";
import { redisClient } from "../config/db.js";
import logger from "./logger.js";

function isRedisReady() {
  return !!(redisClient && redisClient.status === "ready");
}

export function isSuspiciousForwardedHeader(header) {
  if (!header || typeof header !== "string") return false;

  // Excessively long headers may indicate spoofing attempts.
  if (header.length > 512) return true;

  const parts = header.split(",").map((ip) => ip.trim());

  // Reject obviously malformed values.
  return parts.some(
    (ip) => ip.length === 0 || ip.includes("\n") || ip.includes("\r"),
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
      logger.error(
        { err },
        `Failed to initialise Redis rate limiter store "${this.prefix}". Using in-memory fallback.`,
      );
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
 * Normalizes an IP address, converting IPv6 mapped IPv4 and masking IPv6 to /64 subnets.
 */
export function normalizeIp(rawIp) {
  if (!rawIp || typeof rawIp !== "string") return "unknown";
  let ip = rawIp.trim();
  if (ip.includes(",")) ip = ip.split(",")[0].trim();
  ip = ip.replace(/^::ffff:/, "");
  if (ip === "::1") return "127.0.0.1";

  if (ip.includes(":")) {
    const parts = ip.split(":");
    if (parts.length >= 4) {
      return `${parts.slice(0, 4).join(":")}::/64`;
    }
  }
  return ip;
}

/**
 * Generates a rate-limit key from the proxy-resolved IP address.
 */
export function safeIpKeyGenerator(req) {
  const forwarded = req.headers?.["x-forwarded-for"];

  if (isSuspiciousForwardedHeader(forwarded)) {
    logger.warn(
      {
        requestId: req.requestId,
        header: forwarded,
        socketIp: req.socket?.remoteAddress,
      },
      "Suspicious X-Forwarded-For header detected",
    );
  }

  const rawIp =
    req.ip ||
    req.headers?.["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "unknown";

  return normalizeIp(rawIp);
}

/**
 * Keys a limiter by the authenticated principal, falling back to the client IP
 */
export function userKeyGenerator(req) {
  if (req.user?.id) return `user:${req.user.id}`;
  if (req.user?.uid) return `uid:${req.user.uid}`;
  return safeIpKeyGenerator(req);
}

/**
 * Returns a rate-limit handler that logs to Sentry and responds with 429.
 */
function sentryAlertHandler(limiterName) {
  return (req, res) => {
    logger.warn(
      {
        requestId: req.requestId,
        ip: safeIpKeyGenerator(req),
        path: req.originalUrl,
        method: req.method,
        userAgent: req.get("user-agent"),
      },
      `Rate limit exceeded (${limiterName})`,
    );
    Sentry.captureMessage(`Rate limit exceeded: ${limiterName}`, "warning");
    res.status(429).json({
      error: "Rate limit exceeded",
      retryAfter: 60,
    });
  };
}

// Coarse, pre-auth IP limiter. It runs before authentication, so it can only
// key by IP; kept generous so that legitimate users sharing a NAT'd IP are not
// throttled by each other. Per-user fairness is enforced by userLimiter once
// the request is authenticated.
// Configurable rate limiter settings (defaults preserve existing behaviour)
const GLOBAL_WINDOW_MS =
  Number(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const GLOBAL_MAX_REQUESTS =
  Number(process.env.GLOBAL_RATE_LIMIT_MAX_REQUESTS) || 1000;

const USER_WINDOW_MS =
  Number(process.env.USER_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const USER_MAX_REQUESTS =
  Number(process.env.USER_RATE_LIMIT_MAX_REQUESTS) || 300;

const HEALTH_WINDOW_MS =
  Number(process.env.HEALTH_RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const HEALTH_MAX_REQUESTS =
  Number(process.env.HEALTH_RATE_LIMIT_MAX_REQUESTS) || 60;

const AUTH_WINDOW_MS =
  Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000;
const AUTH_MAX_REQUESTS =
  Number(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS) || 10;

const BID_WINDOW_MS = Number(process.env.BID_RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const BID_MAX_REQUESTS = Number(process.env.BID_RATE_LIMIT_MAX_REQUESTS) || 30;

const DEVICE_WINDOW_MS =
  Number(process.env.DEVICE_RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000;
const DEVICE_MAX_REQUESTS =
  Number(process.env.DEVICE_RATE_LIMIT_MAX_REQUESTS) || 10;

const OTP_VERIFICATION_WINDOW_MS =
  Number(process.env.OTP_VERIFICATION_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const OTP_VERIFICATION_MAX_REQUESTS =
  Number(process.env.OTP_VERIFICATION_RATE_LIMIT_MAX_REQUESTS) || 5;

export const globalLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  max: GLOBAL_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore("rl:global:"),
  handler: sentryAlertHandler("globalLimiter"),
  message: { error: "Rate limit exceeded", retryAfter: 900 },
  skip: (req) => req.path === "/health" || req.path.startsWith("/health/"),
});

export const userLimiter = rateLimit({
  windowMs: USER_WINDOW_MS,
  max: USER_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore("rl:user:"),
  handler: sentryAlertHandler("userLimiter"),
  message: { error: "Rate limit exceeded", retryAfter: 900 },
});

export const healthLimiter = rateLimit({
  windowMs: HEALTH_WINDOW_MS,
  max: HEALTH_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore("rl:health:"),
  handler: sentryAlertHandler("healthLimiter"),
  message: { error: "Rate limit exceeded", retryAfter: 60 },
});

export const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore("rl:auth:"),

  handler: (req, res) => {
    logger.warn(
      {
        requestId: req.requestId,
        ip: safeIpKeyGenerator(req),
        path: req.originalUrl,
        method: req.method,
        userAgent: req.get("user-agent"),
      },
      "Authentication rate limit exceeded",
    );

    res.status(429).json({
      error: "Rate limit exceeded",
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
  validate: { keyGeneratorIpFallback: false },
  store: createStore("rl:bid:"),
  handler: sentryAlertHandler("bidLimiter"),
  message: { error: "Rate limit exceeded", retryAfter: 60 },
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
  validate: { keyGeneratorIpFallback: false },
  store: createStore("rl:device:"),
  handler: sentryAlertHandler("deviceLimiter"),
  message: { error: "Rate limit exceeded", retryAfter: 600 },
});

export const otpVerificationLimiter = rateLimit({
  windowMs: OTP_VERIFICATION_WINDOW_MS,
  max: OTP_VERIFICATION_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore("rl:otp-verification:"),
  handler: sentryAlertHandler("otpVerificationLimiter"),
  message: {
    error:
      "Too many OTP verification attempts. Please try again after 15 minutes.",
  },
});

const POD_WINDOW_MS =
  Number(process.env.POD_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000;
const POD_MAX_REQUESTS = Number(process.env.POD_RATE_LIMIT_MAX_REQUESTS) || 10;

// PoD uploads carry up to 20MB each (signature + photo) and run a malware scan
// per file, so they are throttled per driver *and* per order: a single assigned
// driver can no longer fire an unbounded stream of uploads for one order.
export const podUploadLimiter = rateLimit({
  windowMs: POD_WINDOW_MS,
  max: POD_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userKey = userKeyGenerator(req);
    const orderId = req.params?.id || "unknown";
    return `${userKey}:order:${orderId}`;
  },
  validate: { keyGeneratorIpFallback: false },
  store: createStore("rl:pod:"),
  handler: (req, res) => {
    logger.warn(
      {
        requestId: req.requestId,
        path: req.originalUrl,
        method: req.method,
        userAgent: req.get("user-agent"),
      },
      "PoD upload rate limit exceeded",
    );
    Sentry.captureMessage("Rate limit exceeded: podUploadLimiter", "warning");
    res
      .status(429)
      .json({
        error: "Rate limit exceeded",
        retryAfter: Math.ceil(POD_WINDOW_MS / 1000),
      });
  },
});

const adminWindowMs =
  Number(process.env.ADMIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const adminMaxRequests =
  Number(process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS) || 50;

export const adminRateLimiter = rateLimit({
  windowMs: adminWindowMs,
  max: adminMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  store: createStore("rl:admin:"),
  message: {
    error: "Rate limit exceeded",
    retryAfter: Math.ceil(adminWindowMs / 1000),
  },
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
