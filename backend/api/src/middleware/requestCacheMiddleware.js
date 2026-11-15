/**
 * Request Cache Middleware
 * 
 * Caches GET request responses in Redis to improve performance.
 * Includes a null-safety guard for environments where Redis is not configured.
 */

import { redisClient } from '../config/db.js';
import logger from './logger.js';

export function requestCacheMiddleware(durationSeconds = 60) {
  return async (req, res, next) => {
    // Null guard: If redisClient is not initialized or configured, bypass caching safely
    if (!redisClient) {
      return next();
    }

    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Cache entries are user-scoped. Without an authenticated principal we
    // cannot safely reuse a response, so bypass the cache entirely.
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return next();
    }
    const cacheKey = `cache:user:${userId}:${req.originalUrl || req.url}`;

    try {
      const cachedResponse = await redisClient.get(cacheKey);
      if (cachedResponse) {
        logger.debug({ event: 'CACHE_HIT', key: cacheKey }, 'Serving response from cache');
        const parsed = JSON.parse(cachedResponse);
        return res.status(parsed.status || 200).json(parsed.body);
      }

      // Intercept res.json to store the response in cache
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const payload = JSON.stringify({ status: res.statusCode, body });
            redisClient.setEx(cacheKey, durationSeconds, payload).catch((err) => {
              logger.error({ event: 'CACHE_SET_ERROR', error: err?.message, key: cacheKey }, 'Failed to set cache entry');
            });
          }
        } catch (cacheErr) {
          logger.error({ event: 'CACHE_SERIALIZATION_ERROR', error: cacheErr?.message }, 'Failed to serialize response for caching');
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      logger.error({ event: 'CACHE_MIDDLEWARE_ERROR', error: err?.message }, 'Error in request cache middleware');
      return next();
    }
  };
}

export const requestCache = requestCacheMiddleware;
