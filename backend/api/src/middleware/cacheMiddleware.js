import { upstashRedisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

/**
 * Reusable cache-aside middleware using Upstash Redis.
 *
 * @param {number}   ttlSeconds   - Time-to-live in seconds
 * @param {string}   keyPrefix    - Prefix namespace for the cache keys
 * @param {function} keyGenerator - Function returning a unique string from req
 */
export function cacheMiddleware(ttlSeconds, keyPrefix, keyGenerator) {
  return async (req, res, next) => {
    // Prevent caching on non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const uniqueKey = await keyGenerator(req);
    const cacheKey = `cache:${keyPrefix}:${uniqueKey}`;

    try {
      const cached = await upstashRedisClient.get(cacheKey);
      if (cached !== null && cached !== undefined) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
    } catch (err) {
      logger.warn({ err, cacheKey }, '[Cache] Read error');
    }

    res.setHeader('X-Cache', 'MISS');

    // Override res.json to capture response and write to Upstash Redis
    const originalJson = res.json;
    res.json = function (body) {
      res.json = originalJson;

      if (res.statusCode >= 200 && res.statusCode < 300 && body !== null && body !== undefined) {
        upstashRedisClient.set(cacheKey, body, { ex: ttlSeconds }).catch((err) => {
          logger.warn({ err, cacheKey }, '[Cache] Write error');
        });
      }

      return originalJson.call(this, body);
    };

    next();
  };
}
