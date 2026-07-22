import { redisClient } from '../config/db.js';
import logger from './logger.js';

const CACHEABLE_STATUS = new Set([200, 201, 202, 204]);

const inMemoryStore = new Map();
const IN_MEMORY_TTL_MS = 86400_000;
const CLEANUP_INTERVAL_MS = 60_000;

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of inMemoryStore) {
    if (entry.expiresAt <= now) {
      inMemoryStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

cleanupTimer.unref();

function getFromMemory(key) {
  const entry = inMemoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    inMemoryStore.delete(key);
    return null;
  }
  return readAndParse(entry.data);
}

function setInMemory(key, data, ttlMs) {
  inMemoryStore.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function isCacheable(statusCode) {
  return CACHEABLE_STATUS.has(statusCode);
}

function cacheKey(req, idempotencyKey) {
  const identity = req.user?.id || 'anonymous';
  return `idempotency:${req.method}:${req.path}:${identity}:${idempotencyKey}`;
}

function readAndParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export function requireIdempotency(ttlSeconds = 3600) {
  const ttlMs = ttlSeconds * 1000;

  return async function idempotencyMiddleware(req, res, next) {
    const idempotencyKey = req.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      return res.status(400).json({ error: 'X-Idempotency-Key header is required for this action.' });
    }

    const key = cacheKey(req, idempotencyKey);

    try {
      let cached = null;

      if (redisClient) {
        const raw = await redisClient.get(key);
        cached = raw ? readAndParse(raw) : null;
      } else {
        cached = getFromMemory(key);
      }

      if (cached) {
        logger.info(`[Idempotency] Cache hit for key ${idempotencyKey}`);
        return res.status(cached.statusCode).json(cached.body);
      }

      if (redisClient) {
        const lockKey = `${key}:lock`;
        const lockAcquired = await redisClient.set(lockKey, '1', 'NX', 'PX', 10000);
        if (!lockAcquired) {
          await new Promise(r => setTimeout(r, 200));
          const retryRaw = await redisClient.get(key);
          const retryCached = retryRaw ? readAndParse(retryRaw) : null;
          if (retryCached) {
            return res.status(retryCached.statusCode).json(retryCached.body);
          }
          return res.status(409).json({ error: 'Duplicate request being processed' });
        }
      }

      let responded = false;

      const originalJson = res.json.bind(res);
      res.json = function (body) {
        if (responded) return originalJson(body);
        responded = true;

        if (res.statusCode >= 200 && res.statusCode < 300) {
          const cacheData = JSON.stringify({ statusCode: res.statusCode, body });

          if (redisClient) {
            redisClient.set(key, cacheData, 'EX', ttlSeconds).catch(err => {
              logger.error(`[Idempotency] Failed to cache response for key ${idempotencyKey}: ${err.message}`);
            });
          } else {
            setInMemory(key, cacheData, ttlMs);
          }
        }

        if (redisClient) {
          const lockKey = `${key}:lock`;
          redisClient.del(lockKey).catch(() => {});
        }

        return originalJson(body);
      };

      next();
    } catch (err) {
      logger.error(`[Idempotency] Error processing idempotency key: ${err.message}`);
      next();
    }
  };
}
