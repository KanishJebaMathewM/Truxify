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

const inMemorySlidingStore = new Map();

function cleanInMemoryStore(key, now, windowMs) {
  const timestamps = inMemorySlidingStore.get(key) || [];
  const cutoff = now - windowMs;
  const valid = timestamps.filter((t) => t > cutoff);
  inMemorySlidingStore.set(key, valid);
  return valid;
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
  const windowMs = options.windowMs || 60000;
  const maxRequests = options.maxRequests || 100;
  const now = Date.now();

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

  // In-memory sliding window fallback
  const validTimestamps = cleanInMemoryStore(key, now, windowMs);
  if (validTimestamps.length < maxRequests) {
    validTimestamps.push(now);
    inMemorySlidingStore.set(key, validTimestamps);
    return {
      allowed: true,
      count: validTimestamps.length,
      remaining: maxRequests - validTimestamps.length,
      retryAfterMs: 0
    };
  } else {
    const oldest = validTimestamps[0] || now;
    const retryAfterMs = Math.max(1, oldest + windowMs - now);
    return {
      allowed: false,
      count: validTimestamps.length,
      remaining: 0,
      retryAfterMs
    };
  }
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
  redisClient
};
