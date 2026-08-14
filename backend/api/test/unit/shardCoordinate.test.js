import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/shardMiddleware.js', () => ({
  shardMiddleware: (req, _res, next) => next(),
  crossShardQuery: (req, _res, next) => next(),
}));

const { shardManagerMock } = vi.hoisted(() => ({
  shardManagerMock: {
    healthCheck: vi.fn(),
    getShardForLocation: vi.fn(),
    executeQuery: vi.fn(),
    executeCrossShardQuery: vi.fn(),
  },
}));

vi.mock('../../src/services/sharding/ShardManager.js', () => ({ default: shardManagerMock }));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import shardRoutes from '../../src/routes/shardRoutes.js';

function makeApp() {
  const app = express();
  app.use('/', shardRoutes);
  return app;
}

describe('shardRoutes coordinate validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shardManagerMock.getShardForLocation.mockReturnValue('north');
  });

  describe('GET /shards/location', () => {
    it('returns 400 when lat is missing', async () => {
      const res = await request(makeApp()).get('/shards/location').query({ lng: '77.6' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('lat required');
    });

    it('returns 400 for non-numeric coordinates', async () => {
      const res = await request(makeApp()).get('/shards/location').query({ lat: 'abc', lng: '77.6' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('lat must be a finite number');
    });

    it('returns 400 for out-of-range latitude', async () => {
      const res = await request(makeApp()).get('/shards/location').query({ lat: '999', lng: '77.6' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('lat must be between -90 and 90');
    });

    it('returns 400 for out-of-range longitude', async () => {
      const res = await request(makeApp()).get('/shards/location').query({ lat: '12.3', lng: '999' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('lng must be between -180 and 180');
    });

    it('returns the shard name on success', async () => {
      const res = await request(makeApp()).get('/shards/location').query({ lat: '12.3', lng: '77.6' });
      expect(res.status).toBe(200);
      expect(res.body.data.shard).toBe('north');
      expect(res.body.data.lat).toBe(12.3);
      expect(res.body.data.lng).toBe(77.6);
    });

    it('returns 500 on internal error', async () => {
      shardManagerMock.getShardForLocation.mockImplementation(() => { throw new Error('boom'); });
      const res = await request(makeApp()).get('/shards/location').query({ lat: '12.3', lng: '77.6' });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /shards/status', () => {
    it('returns status on success', async () => {
      shardManagerMock.healthCheck.mockResolvedValue({ north: 'healthy' });
      const res = await request(makeApp()).get('/shards/status');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ north: 'healthy' });
    });
  });
});
