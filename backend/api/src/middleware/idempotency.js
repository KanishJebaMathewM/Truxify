import { redisClient } from '../config/db.js';
import logger from './logger.js';
import crypto from 'crypto';

/**
 * Idempotency Middleware
 * Caches the response of state-changing API routes using the X-Idempotency-Key header.
 * 
 * @param {number} ttlSeconds - Time to live for the idempotency key in seconds
 */
export function requireIdempotency(ttlSeconds = 86400) {
  return async (req, res, next) => {
    const idempotencyKey = req.headers['x-idempotency-key'];
    
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'X-Idempotency-Key header is required for this action.' });
    }

    if (!redisClient) {
      logger.warn('[Idempotency] Redis client not available. Bypassing idempotency check.');
      return next();
    }

    const payload = JSON.stringify(req.body || {}) + (req.query ? JSON.stringify(req.query) : '');
    const bodyHash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
    const userPart = req.user?.id || `ip:${req.ip}`;
    const cacheKey = `idempotency:${userPart}:${bodyHash}:${idempotencyKey}`;
    const inFlightKey = `${cacheKey}:inflight`;

    try {
      const inFlight = await redisClient.set(inFlightKey, '1', 'PX', 5000, 'NX');
      if (!inFlight) {
        return res.status(409).json({ error: 'Request already in progress.' });
      }

      // Check if this key already exists
      const cachedResponse = await redisClient.get(cacheKey);
      if (cachedResponse) {
        await redisClient.del(inFlightKey);
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
        
        redisClient.del(inFlightKey).catch(err => {
          logger.error(`[Idempotency] Failed to delete in-flight key: ${err.message}`);
        });

        return originalJson.call(this, body);
      };

      next();
    } catch (err) {
      logger.error(`[Idempotency] Error processing idempotency key: ${err.message}`);
      next(); // Fail open if Redis throws an error
    }
  };
}
