import crypto from 'node:crypto';
import { redisClient } from '../config/db.js';
import logger from './logger.js';

const inMemoryStore = new Map();
const inFlightRequests = new Map(); // In-memory lock for memory-only mode
const IN_MEMORY_TTL_MS = 86400000;
const CLEANUP_INTERVAL_MS = 60000;
const MAX_IN_MEMORY_ENTRIES = 10000;
const EVICTION_BATCH_SIZE = Math.floor(MAX_IN_MEMORY_ENTRIES * 0.1); // evict 10% at a time

// The Redis lock must outlive the longest guarded handler or a slow request's
// lock can expire mid-execution and let a duplicate re-acquire it. Escrow flows
// wait up to 60s for on-chain confirmation (see services/escrow.js), so the
// default 120s gives a comfortable margin. Overridable per deployment.
const LOCK_TTL_MS = Number(process.env.IDEMPOTENCY_LOCK_TTL_MS) || 120000;
const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9_-]{1,255}$/;

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

/**
 * Atomically deletes `lockKey` only if it is still owned by `lockValue`.
 *
 * A plain GET followed by DEL is a check-then-act race: if the lock expires
 * between the two calls and another request acquires it, the DEL would remove
 * the *new* owner's lock. ioredis exposes EVAL, so use a Lua compare-and-delete;
 * fall back to GET+DEL only for minimal clients that cannot run scripts.
 */
const RELEASE_LOCK_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

async function deleteLockIfOwner(client, lockKey, lockValue) {
  if (typeof client.eval === 'function') {
    await client.eval(RELEASE_LOCK_LUA, 1, lockKey, lockValue);
    return;
  }
  const currentVal = await client.get(lockKey);
  if (currentVal === lockValue) {
    await client.del(lockKey);
  }
}

/**
 * Ties the idempotency lock lifetime to the *handler*, not to the socket.
 *
 * Node emits `close` on a ServerResponse both after a normal response AND when
 * the client's TCP connection dies while the handler is still running (mobile
 * network drop, app killed, proxy timeout). Treating every `close` as "request
 * finished" released the lock while the handler was still executing. The
 * client's automatic retry (same X-Idempotency-Key) then found no cached
 * response and no lock, acquired the lock and ran the handler a second time:
 * a duplicate wallet withdrawal / escrow funding / bid acceptance.
 *
 * Rules:
 *  - `finish`                         -> response fully sent: finalize.
 *  - `close` after res.end() was called -> handler is done: finalize.
 *  - `close` BEFORE res.end()         -> client aborted but the handler is still
 *                                        running: keep holding the lock and
 *                                        finalize when the handler ends the
 *                                        response (res.end is wrapped), so the
 *                                        result is cached for the retry.
 *  - A watchdog releases the lock after `maxHoldMs` if the handler never
 *    ends the response, so an abandoned request cannot wedge the key forever
 *    (matters most for the in-memory lock, which has no TTL of its own).
 *
 * `finalize` must be idempotent.
 */
function bindLockLifecycle(res, finalize, maxHoldMs) {
  let abortedBeforeEnd = false;
  let watchdog = null;

  const clearWatchdog = () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const finalizeOnce = () => {
    clearWatchdog();
    return finalize();
  };

  res.once('finish', finalizeOnce);
  res.once('close', () => {
    // `writableEnded === false` is the only reliable "handler has not responded
    // yet" signal. Anything else (true, or undefined on minimal test doubles)
    // means the response was already ended, so it is safe to finalize now.
    if (res.writableEnded === false) {
      abortedBeforeEnd = true;
      watchdog = setTimeout(() => {
        watchdog = null;
        Promise.resolve(finalize()).catch(() => {});
      }, maxHoldMs);
      watchdog.unref?.();
      return;
    }
    finalizeOnce();
  });

  if (typeof res.end === 'function') {
    const originalEnd = res.end;
    res.end = function patchedEnd(...args) {
      try {
        return originalEnd.apply(this, args);
      } finally {
        // The handler finally produced its response after the client had gone
        // away: no `finish` will ever fire, so finalize explicitly. finalize()
        // awaits the pending cache write before releasing the lock.
        if (abortedBeforeEnd) finalizeOnce();
      }
    };
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

    if (!IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
      return res.status(400).json({
        error: 'X-Idempotency-Key is malformed. It must be 1-255 alphanumeric characters, hyphens, or underscores.'
      });
    }

    req.idempotencyKey = idempotencyKey;
    const key = cacheKey(req, idempotencyKey);

    try {
      let pendingCache = null;
      let responded = false;
      let cached = null;

      if (redisClient) {
        const raw = await redisClient.get(key);
        cached = raw ? readAndParse(raw) : null;
      } else {
        cached = getFromMemory(key);
      }

      if (cached) {
        logger.info({ event: 'IDEMPOTENCY_KEY_DETECTED', requestId: req.requestId, idempotencyKey }, 'Cache hit for idempotency key');
        return res.status(cached.statusCode).json(cached.body);
      }

      if (redisClient) {
        const lockKey = `${key}:lock`;
        const lockValue = crypto.randomUUID();
        const lockAcquired = await redisClient.set(lockKey, lockValue, 'NX', 'PX', LOCK_TTL_MS);

        if (!lockAcquired) {
          let retries = 600; // Poll for up to 120 seconds (matches lock TTL)
          let cacheFound = false;

          while (retries > 0) {
            await new Promise((r) => setTimeout(r, 200));
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
          const newLockAcquired = await redisClient.set(lockKey, lockValue, 'NX', 'PX', LOCK_TTL_MS);
          if (!newLockAcquired) {
            return res.status(409).json({ error: 'Duplicate request being processed' });
          }
        }

        let lockReleased = false;
        const releaseLock = async () => {
          if (lockReleased) return;
          lockReleased = true;
          try {
            await deleteLockIfOwner(redisClient, lockKey, lockValue);
          } catch (err) {
            logger.error({ err, lockKey }, '[Idempotency] Failed to release Redis lock.');
          }
        };

        // Ensure the success response is cached BEFORE the lock is released, so
        // a duplicate arriving after 'finish' finds the cached entry and
        // short-circuits instead of re-acquiring the lock and re-entering the
        // handler.
        // finish and close can both fire while the cache write is pending.
        // Share one completion promise so neither event bypasses the wait.
        let finalizationPromise;
        const finalize = () => {
          if (!finalizationPromise) {
            finalizationPromise = (async () => {
              if (pendingCache) {
                const cachePromise = pendingCache;
                pendingCache = null;
                try {
                  await cachePromise;
                } catch (err) {
                  /* error already logged by the cache write's own .catch */
                }
              }
              await releaseLock();
            })();
          }
          return finalizationPromise;
        };

        // Release the lock when the HANDLER finishes (not merely when the socket
        // closes); see bindLockLifecycle for why `close` alone is unsafe.
        bindLockLifecycle(res, finalize, LOCK_TTL_MS);
      } else {
        // Memory-only mode: use in-memory lock to prevent concurrent handler execution
        if (inFlightRequests.has(key)) {
          let retries = 50;
          while (retries > 0 && inFlightRequests.has(key)) {
            await new Promise((r) => setTimeout(r, 200));
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
        // Release when the handler finishes (not merely when the socket closes).
        const releaseMemoryLock = () => { inFlightRequests.delete(key); };
        bindLockLifecycle(res, releaseMemoryLock, LOCK_TTL_MS);
      }

      const originalJson = res.json.bind(res);
      res.json = function (body) {
        if (responded) return originalJson(body);
        responded = true;

        if (res.statusCode >= 200 && res.statusCode < 300) {
          const cacheData = JSON.stringify({ statusCode: res.statusCode, body });

          if (redisClient) {
            pendingCache = redisClient.set(key, cacheData, 'EX', ttlSeconds).catch((err) => {
              logger.error(
                { event: 'IDEMPOTENCY_CACHE_SET_ERROR', idempotencyKey, error: err && err.message },
                '[Idempotency] Failed to cache response'
              );
            });
          } else {
            setInMemory(key, cacheData, ttlMs);
          }
        }

        return originalJson(body);
      };

      next();
    } catch (err) {
      logger.error(
        { event: 'IDEMPOTENCY_PROCESS_ERROR', key: key && key.substring(0, 50), error: err && err.message },
        '[Idempotency] Error processing idempotency key'
      );
      next();
    }
  };
}
