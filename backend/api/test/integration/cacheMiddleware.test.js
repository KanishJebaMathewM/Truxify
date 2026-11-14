// backend/api/test/integration/cacheMiddleware.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { redisClient } from '../../src/config/redis.js';

vi.mock('../../src/config/redis.js', () => ({
  redisClient: {
    get: vi.fn(),
    setex: vi.fn(),
  },
}));

describe('Redis Cache Middleware Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return cached response on Redis cache HIT', async () => {
    const mockCachedPayload = JSON.stringify({ success: true, data: [{ id: 'mini_truck' }] });
    redisClient.get.mockResolvedValue(mockCachedPayload);

    const res = await request(app).get('/api/trucks/types');

    expect(res.statusCode).toEqual(200);
    expect(res.body._cached).toBe(true);
    expect(redisClient.get).toHaveBeenCalledWith('cache:api:/api/trucks/types');
  });
});
