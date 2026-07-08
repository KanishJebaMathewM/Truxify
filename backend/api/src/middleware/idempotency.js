import { redisClient } from '../config/db.js';
import logger from './logger.js';
import crypto from 'crypto';

/**
 * Idempotency Middleware
 * Caches the response of state-changing API routes using the X-Idempotency-Key header.
 * 
 * @param {number} ttlSeconds - Time to live for the idempotency key in seconds
 */
export function requireIdempotency(ttlSeconds = 3600) {
  return async (req, res, next) => {
    const idempotencyKey = req.headers['x-idempotency-key'];
    
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'X-Idempotency-Key header is required for this action.' });
    }

    if (!redisClient) {
      logger.warn('[Idempotency] Redis client not available. Bypassing idempotency check.');
      return next();
    }

    // Identity: authenticated user ID or fallback to IP for unprotected routes
    const identity = req.user?.id || req.ip || 'unknown-ip';
    // Hash the request body to differentiate requests with different payloads
    const bodyHash = req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0
      ? crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex').slice(0, 16)
      : '';
    const cacheKey = `idempotency:${identity}:${idempotencyKey}:${bodyHash}`;
    const inflightKey = `${cacheKey}:inflight`;

    try {
      // In-flight marker: detect concurrent requests with the same key
      const inflight = await redisClient.set(inflightKey, '1', 'PX', 30000, 'NX');
      if (!inflight) {
        logger.warn(`[Idempotency] Concurrent request detected for key ${idempotencyKey}`);
        return res.status(409).json({ error: 'A request with this idempotency key is already in progress.' });
      }

      // Check if this key already exists
      const cachedResponse = await redisClient.get(cacheKey);
      if (cachedResponse) {
        // Clean up in-flight marker since we have a cached response
        redisClient.del(inflightKey).catch(() => {});
        logger.info(`[Idempotency] Cache hit for key ${idempotencyKey}`);
        const parsed = JSON.parse(cachedResponse);
        return res.status(parsed.statusCode).json(parsed.body);
      }

      // Safety cleanup: remove in-flight marker when response finishes
      res.on('finish', () => {
        redisClient.del(inflightKey).catch(() => {});
      });

      // If not, we intercept the res.json to cache the response before sending it
      const originalJson = res.json;
      res.json = function (body) {
        // Only cache successful or non-server-error responses (e.g. 200, 400, 409)
        // If it's a 500, we don't want to cache the error so the client can retry.
        if (res.statusCode < 500) {
          const cacheData = JSON.stringify({
            statusCode: res.statusCode,
            body: body
          });
          
          redisClient.set(cacheKey, cacheData, 'EX', ttlSeconds).catch(err => {
            logger.error(`[Idempotency] Failed to cache response for key ${idempotencyKey}: ${err.message}`);
          });
        }
        
        return originalJson.call(this, body);
      };

      next();
    } catch (err) {
      logger.error(`[Idempotency] Error processing idempotency key: ${err.message}`);
      next(); // Fail open if Redis throws an error
    }
  };
}

    if (!redisClient) {
      logger.warn('[Idempotency] Redis client not available. Bypassing idempotency check.');
      return next();
    }

    const cacheKey = `idempotency:${req.user?.id || 'anonymous'}:${idempotencyKey}`;

    try {
      // Check if this key already exists
      const cachedResponse = await redisClient.get(cacheKey);
      if (cachedResponse) {
        logger.info(`[Idempotency] Cache hit for key ${idempotencyKey}`);
        const parsed = JSON.parse(cachedResponse);
        return res.status(parsed.statusCode).json(parsed.body);
      }

      // If not, we intercept the res.json to cache the response before sending it
      const originalJson = res.json;
      res.json = function (body) {
        // Only cache successful or non-server-error responses (e.g. 200, 400, 409)
        // If it's a 500, we don't want to cache the error so the client can retry.
        if (res.statusCode < 500) {
          const cacheData = JSON.stringify({
            statusCode: res.statusCode,
            body: body
          });
          
          redisClient.set(cacheKey, cacheData, 'EX', ttlSeconds).catch(err => {
            logger.error(`[Idempotency] Failed to cache response for key ${idempotencyKey}: ${err.message}`);
          });
        }
        
        return originalJson.call(this, body);
      };

      next();
    } catch (err) {
      logger.error(`[Idempotency] Error processing idempotency key: ${err.message}`);
      next(); // Fail open if Redis throws an error
    }
  };
}
