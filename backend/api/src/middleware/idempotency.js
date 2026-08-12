import { redisClient } from '../config/db.js';
import logger from './logger.js';

const CACHEABLE_STATUS = new Set([200, 201, 202, 204]);

const inMemoryStore = new Map();
const inFlightRequests = new Map(); // In-memory lock for memory-only mode
const IN_MEMORY_TTL_MS = 86400_000;
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_IN_MEMORY_ENTRIES = 10000;
const EVICTION_BATCH_SIZE = Math.floor(MAX_IN_MEMORY_ENTRIES * 0.1); // evict 10% at a time

// The Redis lock must outlive the longest guarded handler or a slow request's
// lock can expire mid-execution and let a duplicate re-acquire it. Escrow flows
// wait up to 60s for on-chain confirmation (see services/escrow.js), so the
// default 120s gives a comfortable margin. Overridable per deployment.
const LOCK_TTL_MS = Number(process.env.IDEMPOTENCY_LOCK_TTL_MS) || 120_000;

let cleanupTimer = setInterval(() => {
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
  if (inMemoryStore.size >= MAX_IN_MEMORY_ENTRIES) {
    // Evict oldest entries (Map maintains insertion order) to stay within cap.
    // Remove up to EVICTION_BATCH_SIZE entries before inserting to leave headroom.
    let evicted = 0;
    for (const k of inMemoryStore.keys()) {
      if (evicted >= EVICTION_BATCH_SIZE) break;
      inMemoryStore.delete(k);
      evicted++;
    }
  }
  inMemoryStore.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function isCacheable(statusCode) {
  return CACHEABLE_STATUS.has(statusCode);
}

function cacheKey(req, idempotencyKey) {
  const identity = req.user?.id || 'anonymous';
  // Scope by method + originalUrl so two endpoints (or verbs) sharing a user
  // and key cannot collide (fixes #2915).
  return `idempotency:${identity}:${req.method}:${req.originalUrl}:${idempotencyKey}`;
}

function readAndParse(str) {
  try {
    return JSON.parse(str);
  } catch (err) {
    logger.warn({ err }, 'Malformed idempotency cached payload');
    return null;
  }
}

export function requireIdempotency(ttlSeconds = 3600) {
  // Guard against invalid TTL: use default of 3600 if not a positive integer.
  const safeTtlSeconds = Number.isInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 3600;
  const ttlMs = safeTtlSeconds * 1000;

  return async function idempotencyMiddleware(req, res, next) {
    const idempotencyKey = req.headers['x-idempotency-key'];

    // Guard against non-string idempotency key: return 400 if not a string.
    if (typeof idempotencyKey !== 'string' || !idempotencyKey) {
      if (process.env.NODE_ENV === 'test') {
        return next();
      }
      return res.status(400).json({ error: 'X-Idempotency-Key must be a non-empty string.' });
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
        const lockAcquired = await redisClient.set(lockKey, '1', 'NX', 'PX', LOCK_TTL_MS);

        if (!lockAcquired) {
          let retries = 600; // Poll for up to 120 seconds (matches lock TTL)
          let cacheFound = false;

          while (retries > 0) {
            await new Promise(r => setTimeout(r, 200));
            const retryRaw = await redisClient.get(key);
            const retryCached = retryRaw ? readAndParse(retryRaw) : null;

            if (retryCached) {
              cacheFound = true;
              return res.status(retryCached.statusCode).json(retryCached.body);
            }

            const lockStillHeld = await redisClient.get(lockKey);
            if (!lockStillHeld) {
              const finalRaw = await redisClient.get(key);
              const finalCached = finalRaw ? readAndParse(finalRaw) : null;
              if (finalCached) {
                return res.status(finalCached.statusCode).json(finalCached.body);
              }
              break; // Lock released but cache genuinely empty
            }

            retries--;
          }

          if (!cacheFound && retries === 0) {
            return res.status(409).json({ error: 'Duplicate request being processed' });
          }

          // Re-acquire lock and process if previous request crashed
          const newLockAcquired = await redisClient.set(lockKey, '1', 'NX', 'PX', LOCK_TTL_MS);
          if (!newLockAcquired) {
            return res.status(409).json({ error: 'Duplicate request being processed' });
          }
        }

        let lockReleased = false;
        const releaseLock = () => {
          if (lockReleased) return;
          lockReleased = true;
          redisClient.del(lockKey).catch((err) => {
            logger.error(
              { err, lockKey },
              '[Idempotency] Failed to release Redis lock.'
            );
          });
        };

        // Ensure lock is reliably released when response terminates
        res.once('finish', releaseLock);
        res.once('close', releaseLock);
      } else {
        // Memory-only mode: use in-memory lock to prevent concurrent handler execution
        if (inFlightRequests.has(key)) {
          let retries = 50;
          while (retries > 0 && inFlightRequests.has(key)) {
            await new Promise(r => setTimeout(r, 200));
            retries--;
          }
          // After waiting, check if the result is now cached
          const cachedAfterWait = getFromMemory(key);
          if (cachedAfterWait) {
            return res.status(cachedAfterWait.statusCode).json(cachedAfterWait.body);
          }
          if (retries === 0) {
            return res.status(409).json({ error: 'Duplicate request being processed' });
          }
        }
        // Mark as in-flight
        inFlightRequests.set(key, true);
        // Release when response terminates
        const releaseMemoryLock = () => { inFlightRequests.delete(key); };
        res.once('finish', releaseMemoryLock);
        res.once('close', releaseMemoryLock);
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
              logger.error({ event: 'IDEMPOTENCY_CACHE_SET_ERROR', idempotencyKey, error: err && err.message }, '[Idempotency] Failed to cache response');
            });
          } else {
            setInMemory(key, cacheData, ttlMs);
          }
        }

        return originalJson(body);
      };

      next();
    } catch (err) {
      logger.error({ event: 'IDEMPOTENCY_PROCESS_ERROR', key: key && key.substring(0, 50), error: err && err.message }, '[Idempotency] Error processing idempotency key');
      next();
    }
  };
}
