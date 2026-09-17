import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requireIdempotency } from '../idempotency.js';

describe('requireIdempotency Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            headers: {},
            method: 'POST',
            originalUrl: '/api/v1/bookings',
            user: { id: 'user-123' }
        };
        res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            once: vi.fn()
        };
        next = vi.fn();
        process.env.NODE_ENV = 'test';
    });

    it('should call next() in test environment if x-idempotency-key is missing', async () => {
        const middleware = requireIdempotency(3600);
        await middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('should return 400 if x-idempotency-key is an array (malformed)', async () => {
        process.env.NODE_ENV = 'development';
        req.headers['x-idempotency-key'] = ['key1', 'key2'];
        const middleware = requireIdempotency(3600);
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'X-Idempotency-Key must be a non-empty string.' });
    });

    it('should return 400 if x-idempotency-key contains invalid characters', async () => {
        process.env.NODE_ENV = 'development';
        req.headers['x-idempotency-key'] = 'invalid key with spaces!@#';
        const middleware = requireIdempotency(3600);
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'X-Idempotency-Key is malformed. It must be 1-255 alphanumeric characters, hyphens, or underscores.'
        });
    });

    it('should return 400 if x-idempotency-key exceeds 255 characters', async () => {
        process.env.NODE_ENV = 'development';
        req.headers['x-idempotency-key'] = 'a'.repeat(256);
        const middleware = requireIdempotency(3600);
        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'X-Idempotency-Key is malformed. It must be 1-255 alphanumeric characters, hyphens, or underscores.'
        });
    });

    it('should accept valid x-idempotency-key and proceed', async () => {
        process.env.NODE_ENV = 'development';
        req.headers['x-idempotency-key'] = 'valid-key_123-ABC';
        const middleware = requireIdempotency(3600);
        await middleware(req, res, next);
        expect(req.idempotencyKey).toBe('valid-key_123-ABC');
        expect(next).toHaveBeenCalled();
    });
});
