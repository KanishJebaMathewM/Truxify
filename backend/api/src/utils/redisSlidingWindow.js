import Redis from 'ioredis';
import { redisClient as sharedRedisClient } from '../config/db.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
let redisClient = sharedRedisClient;

const SLIDING_WINDOW_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  
  redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
  local count = redis.call('ZCARD', key)
  
  if count < limit then
    redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
    redis.call('PEXPIRE', key, window)
    return 1
  else
    return 0
  end
`;

const checkRateLimit = async (key, windowMs, maxRequests) => {
    try {
        const client = redisClient || sharedRedisClient;
        if (!client || typeof client.eval !== 'function') return true;
        const now = Date.now();

        const result = await client.eval(
            SLIDING_WINDOW_SCRIPT,
            1,
            key,
            now.toString(),
            windowMs.toString(),
            maxRequests.toString()
        );

        return result === 1;
    } catch (err) {
        console.warn('Redis rate limit check failed, falling back to memory/allow:', err.message);
        return true;
    }
};

export {
    checkRateLimit,
    redisClient,
};

export default {
    checkRateLimit,
    redisClient,
};

