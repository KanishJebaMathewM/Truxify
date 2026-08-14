import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
  createStore: vi.fn(() => ({ increment: vi.fn(), decrement: vi.fn(), resetKey: vi.fn() })),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

const { shardManagerMock } = vi.hoisted(() => ({
  shardManagerMock: {
    healthCheck: vi.fn(),
    getShardForLocation: vi.fn(),
    executeQuery: vi.fn(),
  },
}));

vi.mock('../../src/services/sharding/ShardManager.js', () => ({
  default: shardManagerMock,
}));

vi.mock('../../src/middleware/shardMiddleware.js', () => ({
  shardMiddleware: (_req, _res, next) => next(),
  crossShardQuery: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import shardRoutes from '../../src/routes/shardRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/shards', shardRoutes);
  return app;
}

describe('shardRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /shards/status', () => {
    it('returns shard health status on success', async () => {
      shardManagerMock.healthCheck.mockResolvedValue({ status: 'healthy', shards: ['shard-1'] });
      const res = await request(makeApp()).get('/shards/shards/status');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('healthy');
    });

    it('returns 500 when shardManager.healthCheck throws', async () => {
      shardManagerMock.healthCheck.mockRejectedValue(new Error('shard manager unavailable'));
      const res = await request(makeApp()).get('/shards/shards/status');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /shards/location', () => {
    it('returns shard for valid coordinates', async () => {
      shardManagerMock.getShardForLocation.mockReturnValue('shard-us-west');
      const res = await request(makeApp())
        .get('/shards/shards/location')
        .query({ lat: '40.7128', lng: '-74.0060' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.shard).toBe('shard-us-west');
    });

    it('returns 400 when lat is missing', async () => {
      const res = await request(makeApp())
        .get('/shards/shards/location')
        .query({ lng: '-74.0060' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('lat required');
    });

    it('returns 400 when lng is missing', async () => {
      const res = await request(makeApp())
        .get('/shards/shards/location')
        .query({ lat: '40.7128' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('lng required');
    });

    it('returns 400 when lat is not a finite number', async () => {
      const res = await request(makeApp())
        .get('/shards/shards/location')
        .query({ lat: 'not-a-number', lng: '-74.0060' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('finite number');
    });

    it('returns 400 when lat is out of range', async () => {
      const res = await request(makeApp())
        .get('/shards/shards/location')
        .query({ lat: '95', lng: '-74.0060' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('between -90 and 90');
    });

    it('returns 400 when lng is out of range', async () => {
      const res = await request(makeApp())
        .get('/shards/shards/location')
        .query({ lat: '40.7128', lng: '-200' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('between -180 and 180');
    });
  });

  describe('GET /shards/:shardName/orders', () => {
    it('returns orders from the specified shard', async () => {
      const mockRows = [{ id: 'order-1' }, { id: 'order-2' }];
      shardManagerMock.executeQuery.mockResolvedValue(mockRows);
      const res = await request(makeApp()).get('/shards/shards/shard-us-west/orders');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockRows);
      expect(res.body.shard).toBe('shard-us-west');
    });

    it('returns 500 when executeQuery throws', async () => {
      shardManagerMock.executeQuery.mockRejectedValue(new Error('db connection failed'));
      const res = await request(makeApp()).get('/shards/shards/shard-us-west/orders');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });
});

// Additional coverage: error handling edge cases
describe('shardRoutes extended coverage', () => {
  describe('GET /shards/health', () => {
    it('returns 200 with ok status', async () => {
      const { default: express } = await import('express');
      const { default: request } = await import('supertest');
      const shardRoutes = (await import('../../src/routes/shardRoutes.js')).default;
      const app = express();
      app.use(express.json());
      app.use('/shards', shardRoutes);
      const res = await request(app).get('/shards/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
