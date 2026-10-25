import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireIdempotency } from '../../src/middleware/idempotency.js';

vi.mock('../../src/config/db.js', () => {
  const store = new Map();
  return {
    redisClient: {
      get: vi.fn(async (key) => store.get(key) || null),
      set: vi.fn(async (key, val) => {
        store.set(key, val);
        return 'OK';
      }),
      del: vi.fn(async (key) => {
        store.delete(key);
        return 1;
      }),
      __store: store
    }
  };
});

describe('Idempotency Redis Lock Ownership Tests', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: { 'x-idempotency-key': 'valid-uuid-key-12345' },
      method: 'POST',
      originalUrl: '/api/v1/orders'
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      once: vi.fn(),
      statusCode: 200
    };
    next = vi.fn();
  });

  it('should accept valid x-idempotency-key format', async () => {
    const middleware = requireIdempotency(3600);
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject malformed x-idempotency-key with 400 Bad Request', async () => {
    req.headers['x-idempotency-key'] = 'invalid key with spaces!!';
    const middleware = requireIdempotency(3600);
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('malformed') })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
