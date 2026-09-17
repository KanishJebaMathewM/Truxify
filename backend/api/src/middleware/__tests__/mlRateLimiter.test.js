import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucketRateLimiter } from '../mlRateLimiter.js';

const mockRedisClient = {
    isReady: true,
    eval: vi.fn()
};

vi.mock('../../config/db.js', () => ({
    redisClient: mockRedisClient
}));

describe('TokenBucketRateLimiter', () => {
    let limiter;
    let req;
    let res;
    let next;

    beforeEach(() => {
        limiter = new TokenBucketRateLimiter({
            capacity: 5,
            refillRate: 1,
            prefix: 'test_limit'
        });

        req = {
            ip: '192.168.1.1',
            connection: { remoteAddress: '192.168.1.1' },
            headers: { 'user-agent': 'TestAgent/1.0' },
            user: null
        };

        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn()
        };

        next = vi.fn();
        mockRedisClient.eval.mockReset();
    });

    it('should call next() and set headers when request is allowed', async () => {
        mockRedisClient.eval.mockResolvedValue([1, 4]); // Allowed, 4 tokens remaining

        await limiter.consume(req, res, next);

        expect(mockRedisClient.eval).toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
        expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
        expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 4);
    });

    it('should return 429 if rate limit is exceeded', async () => {
        mockRedisClient.eval.mockResolvedValue([0, 0.2]); // Not allowed, 0.2 tokens remaining

        await limiter.consume(req, res, next);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded for ML pricing endpoints. Please slow down your requests.',
            retryAfter: 1 // Math.ceil((1 - 0.2) / 1)
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('should use user ID for client identification if authenticated', async () => {
        req.user = { id: 'user-123' };
        mockRedisClient.eval.mockResolvedValue([1, 4]);

        await limiter.consume(req, res, next);

        const callArgs = mockRedisClient.eval.mock.calls[0];
        expect(callArgs[2]).toBe('test_limit:user:user-123');
        expect(next).toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully and fall back to in-memory', async () => {
        mockRedisClient.eval.mockRejectedValue(new Error('Redis connection failed'));

        await limiter.consume(req, res, next);

        // Should not crash, should call next() to allow the request via in-memory fallback
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(429);
    });

    it('should enforce in-memory rate limit when Redis is unavailable', async () => {
        mockRedisClient.isReady = false;

        // First request should pass
        await limiter.consume(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);

        // Exhaust the bucket (capacity is 5, we already used 1)
        for (let i = 0; i < 4; i++) {
            await limiter.consume(req, res, next);
        }

        // 6th request should be blocked
        await limiter.consume(req, res, next);
        expect(res.status).toHaveBeenCalledWith(429);
    });
});
