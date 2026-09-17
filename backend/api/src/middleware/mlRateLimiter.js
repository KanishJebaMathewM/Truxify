/**
 * Strict Token-Bucket Rate Limiter for ML-driven endpoints.
 * Designed to prevent model extraction attacks via excessive scraping.
 * Uses Redis for distributed rate limiting with an in-memory fallback.
 */
import { redisClient } from '../config/db.js';
import logger from './logger.js';
import crypto from 'crypto';

const DEFAULT_CAPACITY = 5; // Max requests allowed in burst
const DEFAULT_REFILL_RATE = 0.5; // 1 request every 2 seconds
const IN_MEMORY_TTL_MS = 3600000; // 1 hour

class TokenBucketRateLimiter {
    constructor(options = {}) {
        this.capacity = options.capacity || DEFAULT_CAPACITY;
        this.refillRate = options.refillRate || DEFAULT_REFILL_RATE;
        this.prefix = options.prefix || 'ml_rate_limit';
        this.inMemoryBuckets = new Map();
        this.cleanupInterval = setInterval(() => this._cleanupInMemory(), 60000);
        this.cleanupInterval.unref();
    }

    async consume(req, res, next) {
        const clientId = this._getClientIdentifier(req);
        const key = `${this.prefix}:${clientId}`;
        const now = Date.now();

        // If Redis is available, use distributed rate limiting
        if (redisClient && (redisClient.status === 'ready' || redisClient.isReady)) {
            try {
                const luaScript = `
          local key = KEYS[1]
          local capacity = tonumber(ARGV[1])
          local refill_rate = tonumber(ARGV[2])
          local now = tonumber(ARGV[3])
          
          local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
          local tokens = tonumber(bucket[1]) or capacity
          local last_refill = tonumber(bucket[2]) or now
          
          local time_passed = (now - last_refill) / 1000
          local new_tokens = math.min(capacity, tokens + (time_passed * refill_rate))
          
          if new_tokens >= 1 then
            new_tokens = new_tokens - 1
            redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
            redis.call('EXPIRE', key, 3600)
            return {1, new_tokens}
          else
            redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
            redis.call('EXPIRE', key, 3600)
            return {0, new_tokens}
          end
        `;

                const result = await redisClient.eval(luaScript, 1, key, this.capacity, this.refillRate, now);
                const allowed = result[0] === 1;
                const remainingTokens = result[1];

                if (!allowed) {
                    logger.warn({ clientId, key, remainingTokens }, '[MLRateLimiter] Rate limit exceeded');
                    return res.status(429).json({
                        error: 'Too Many Requests',
                        message: 'Rate limit exceeded for ML pricing endpoints. Please slow down your requests.',
                        retryAfter: Math.ceil((1 - remainingTokens) / this.refillRate)
                    });
                }

                res.setHeader('X-RateLimit-Limit', this.capacity);
                res.setHeader('X-RateLimit-Remaining', Math.floor(remainingTokens));
                return next();
            } catch (err) {
                logger.error({ err, key }, '[MLRateLimiter] Redis error, falling back to in-memory');
            }
        }

        // In-memory fallback for resilience during Redis outages
        const bucket = this.inMemoryBuckets.get(key) || { tokens: this.capacity, lastRefill: now };
        const timePassed = (now - bucket.lastRefill) / 1000;
        const newTokens = Math.min(this.capacity, bucket.tokens + (timePassed * this.refillRate));

        if (newTokens >= 1) {
            bucket.tokens = newTokens - 1;
            bucket.lastRefill = now;
            this.inMemoryBuckets.set(key, bucket);

            res.setHeader('X-RateLimit-Limit', this.capacity);
            res.setHeader('X-RateLimit-Remaining', Math.floor(bucket.tokens));
            return next();
        }

        logger.warn({ clientId, key, tokens: newTokens }, '[MLRateLimiter] In-memory rate limit exceeded');
        return res.status(429).json({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded for ML pricing endpoints. Please slow down your requests.',
            retryAfter: Math.ceil((1 - newTokens) / this.refillRate)
        });
    }

    _getClientIdentifier(req) {
        if (req.user && req.user.id) {
            return `user:${req.user.id}`;
        }
        const ip = req.ip || req.connection.remoteAddress || 'unknown_ip';
        const ua = req.headers['user-agent'] || 'unknown_ua';
        return `anon:${crypto.createHash('sha256').update(`${ip}:${ua}`).digest('hex').substring(0, 16)}`;
    }

    _cleanupInMemory() {
        const now = Date.now();
        for (const [key, bucket] of this.inMemoryBuckets.entries()) {
            if (now - bucket.lastRefill > IN_MEMORY_TTL_MS) {
                this.inMemoryBuckets.delete(key);
            }
        }
    }
}

export const strictMlRateLimiter = new TokenBucketRateLimiter({
    capacity: 5,
    refillRate: 0.5,
    prefix: 'ml_pricing_limit'
});

export default strictMlRateLimiter;
