import { redisClient as sharedRedisClient } from '../config/db.js';

let redisClient = sharedRedisClient;

const SLIDING_WINDOW_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local windowMs = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  
  -- Clear entries older than current sliding window
  redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
  local count = redis.call('ZCARD', key)
  
  if count < limit then
    redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
    redis.call('PEXPIRE', key, windowMs)
    return {1, count + 1, limit - (count + 1), 0}
  else
    -- Fetch oldest timestamp in window to calculate exact retryAfter
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retryAfterMs = windowMs
    if oldest and #oldest >= 2 then
      retryAfterMs = math.max(1, math.floor(tonumber(oldest[2]) + windowMs - now))
    end
    return {0, count, 0, retryAfterMs}
  end
`;

export const MAX_TRACKED_RATE_LIMIT_KEYS = 10000;
export const MAX_RATE_LIMIT_KEY_LENGTH = 512;
export const MAX_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_RATE_LIMIT_REQUESTS = 1000000;
export const RATE_LIMIT_SWEEP_INTERVAL_MS = 60 * 1000;

// key -> { timestamps, windowMs, lastSeen }
const inMemorySlidingStore = new Map();
let lastSweepAt = 0;

function normalizePositiveInteger(value, fallback, name, max) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new RangeError(`${name} must be a positive integer no greater than ${max}`);
  }
  return value;
}

/**
 * Drops fallback entries whose last request is older than their own window.
 * Returns the number of removed keys. Exported so maintenance and tests can
 * force a sweep without waiting for the periodic interval.
 */
export function pruneSlidingWindowFallback(now = Date.now()) {
  let removed = 0;
  for (const [key, entry] of inMemorySlidingStore) {
    if (now - entry.lastSeen > entry.windowMs) {
      inMemorySlidingStore.delete(key);
      removed += 1;
    }
  }
  lastSweepAt = now;
  return removed;
}

/** Number of keys currently held by the in-memory fallback. */
export function getSlidingWindowFallbackSize() {
  return inMemorySlidingStore.size;
}

function getInMemoryEntry(key, now, windowMs) {
  let entry = inMemorySlidingStore.get(key);
  if (!entry) {
    entry = { timestamps: [], windowMs, lastSeen: now };
    inMemorySlidingStore.set(key, entry);
  } else {
    // Re-insert so Map iteration order tracks least-recently-used keys.
    inMemorySlidingStore.delete(key);
    inMemorySlidingStore.set(key, entry);
  }

  entry.windowMs = windowMs;
  entry.lastSeen = now;
  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > cutoff);
  return entry;
}

/**
 * Checks sliding window rate limit with detailed rate limit metadata.
 * @param {string} key Unique rate limit key (e.g. rate:ip:127.0.0.1)
 * @param {Object} [options]
 * @param {number} [options.windowMs=60000] Window size in milliseconds
 * @param {number} [options.maxRequests=100] Maximum requests per window
 * @returns {Promise<{allowed: boolean, count: number, remaining: number, retryAfterMs: number}>}
 */
export const checkSlidingWindowRateLimit = async (key, options = {}) => {
  const windowMs = normalizePositiveInteger(
    options.windowMs,
    60000,
    'windowMs',
    MAX_RATE_LIMIT_WINDOW_MS
  );
  const maxRequests = normalizePositiveInteger(
    options.maxRequests,
    100,
    'maxRequests',
    MAX_RATE_LIMIT_REQUESTS
  );
  const now = Date.now();

  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_RATE_LIMIT_KEY_LENGTH) {
    return {
      allowed: false,
      count: 0,
      remaining: 0,
      retryAfterMs: windowMs
    };
  }

  try {
    const client = redisClient || sharedRedisClient;
    if (client && typeof client.eval === 'function' && client.status === 'ready') {
      const res = await client.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        key,
        now.toString(),
        windowMs.toString(),
        maxRequests.toString()
      );

      if (Array.isArray(res)) {
        return {
          allowed: res[0] === 1,
          count: res[1],
          remaining: res[2],
          retryAfterMs: res[3]
        };
      }
    }
  } catch (err) {
    // Fall back to in-memory sliding window on Redis error
  }

  // In-memory sliding window fallback. Sweep the whole store periodically so
  // keys that are no longer requested cannot retain memory forever.
  if (now - lastSweepAt >= RATE_LIMIT_SWEEP_INTERVAL_MS) {
    pruneSlidingWindowFallback(now);
  }

  const isNewKey = !inMemorySlidingStore.has(key);
  if (isNewKey && inMemorySlidingStore.size >= MAX_TRACKED_RATE_LIMIT_KEYS) {
    const oldestKey = inMemorySlidingStore.keys().next().value;
    if (oldestKey !== undefined) inMemorySlidingStore.delete(oldestKey);
  }

  const entry = getInMemoryEntry(key, now, windowMs);
  if (entry.timestamps.length < maxRequests) {
    entry.timestamps.push(now);
    return {
      allowed: true,
      count: entry.timestamps.length,
      remaining: maxRequests - entry.timestamps.length,
      retryAfterMs: 0
    };
  }

  const oldest = entry.timestamps[0] || now;
  const retryAfterMs = Math.max(1, oldest + windowMs - now);
  return {
    allowed: false,
    count: entry.timestamps.length,
    remaining: 0,
    retryAfterMs
  };
};

/**
 * Legacy boolean check for backward compatibility.
 */
export const checkRateLimit = async (key, windowMs, maxRequests) => {
  const result = await checkSlidingWindowRateLimit(key, { windowMs, maxRequests });
  return result.allowed;
};

export { redisClient };

export default {
  checkRateLimit,
  checkSlidingWindowRateLimit,
  pruneSlidingWindowFallback,
  getSlidingWindowFallbackSize,
  redisClient
};
