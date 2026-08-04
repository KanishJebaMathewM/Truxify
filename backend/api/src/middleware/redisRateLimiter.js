import { redisClient } from '../config/db.js';
import logger from './logger.js';

/**
 * Creates an Express middleware that enforces a per-user sliding-window
 * rate limit using a Redis sorted set.
 *
 * Key: `rl:{routeKey}:{userId}`
 * Score: request timestamp in ms
 *
 * On each request:
 *   1. Remove members older than the window (ZREMRANGEBYSCORE)
 *   2. Count remaining members (ZCARD)
 *   3. If count >= limit → 429, do NOT record the request
 *   4. Otherwise → ZADD the new request, set key TTL, next()
 *
 * Recording blocked requests is intentionally skipped so that a client
 * retrying after a 429 does not keep pushing the oldest-entry timestamp
 * forward and extend their own ban indefinitely.
 *
 * Failure semantics — fail open:
 *   A Redis outage does not block all user traffic. A warning is logged
 *   so ops is aware that rate limiting is temporarily inactive.
 *
 * @param {object} options
 * @param {string} options.routeKey   Unique name for the route, e.g. 'zkp_verify'
 * @param {number} options.limit      Max requests per window
 * @param {number} options.windowMs   Window size in milliseconds
 */
export function redisRateLimiter({ routeKey, limit, windowMs }) {
  return async (req, res, next) => {
    if (!redisClient) {
      logger.warn({ routeKey }, '[RateLimiter] Redis unavailable — rate limiting bypassed');
      return next();
    }

    const userId = req.user?.id ?? req.ip;
    const key = `rl:${routeKey}:${userId}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Phase 1: evict stale entries and count current window — no write yet.
      const pipeline = redisClient.pipeline();
      pipeline.zremrangebyscore(key, '-inf', windowStart);
      pipeline.zcard(key);
      const results = await pipeline.exec();

      // Validate ZCARD result tuple [error, value].
      const zcardTuple = results[1];
      if (!zcardTuple || zcardTuple[0]) {
        logger.warn({ routeKey, err: zcardTuple?.[0] }, '[RateLimiter] ZCARD failed — failing open');
        return next();
      }
      const requestCount = zcardTuple[1];

      if (requestCount >= limit) {
        // Compute Retry-After from the oldest entry still in the window.
        const oldestScore = await redisClient.zrange(key, 0, 0, 'WITHSCORES');
        const retryAfterMs =
          oldestScore.length >= 2
            ? Math.ceil(windowMs - (now - Number(oldestScore[1])))
            : windowMs;

        res.set('Retry-After', Math.ceil(retryAfterMs / 1000));
        return res.status(429).json({
          success: false,
          error: 'Too many requests. Please slow down.',
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        });
      }

      // Phase 2: request is within limit — record it now.
      await redisClient.pipeline()
        .zadd(key, now, `${now}-${Math.random()}`)
        .pexpire(key, windowMs)
        .exec();

      next();
    } catch (err) {
      logger.error({ err, routeKey }, '[RateLimiter] Redis error — failing open');
      next();
    }
  };
}
