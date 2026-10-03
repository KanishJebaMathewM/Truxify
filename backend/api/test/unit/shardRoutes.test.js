import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockAuthenticate, mockRequirePolicy, shardManagerMock } = vi.hoisted(() => {
  const requirePolicyMock = vi.fn((policy) => (req, res, next) => {
    if (requirePolicyMock.handler) {
      return requirePolicyMock.handler(policy, req, res, next);
    }
    next();
  });

  return {
    mockAuthenticate: vi.fn((req, _res, next) => {
      req.user = { id: 'user-1' };
      next();
    }),
    mockRequirePolicy: requirePolicyMock,
    shardManagerMock: {
      healthCheck: vi.fn(),
      getShardForLocation: vi.fn(),
      executeQuery: vi.fn(),
    },
  };
});

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => mockAuthenticate(req, res, next),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
  createStore: vi.fn(() => ({ increment: vi.fn(), decrement: vi.fn(), resetKey: vi.fn() })),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: (...args) => mockRequirePolicy(...args),
}));

vi.mock('../../src/services/sharding/ShardManager.js', () => ({
  default: shardManagerMock,
}));

vi.mock('../../src/middleware/shardMiddleware.js', () => ({
  shardMiddleware: (_req, _res, next) => next(),
  crossShardQuery: (req, _res, next) => {
    req.executeCrossShard = req.executeCrossShard || vi.fn();
    next();
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import shardRoutes from '../../src/routes/shardRoutes.js';

function makeApp(customMiddleware) {
  const app = express();
  app.use(express.json());
  if (customMiddleware) {
    app.use(customMiddleware);
  }
  app.use('/api', shardRoutes);
  return app;
}

describe('shardRoutes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockImplementation((req, _res, next) => {
      req.user = { id: 'user-1' };
      next();
    });
    mockRequirePolicy.handler = null;
    app = makeApp();
  });

  describe('GET /api/shards/status', () => {
    it('returns shard health status on success', async () => {
      shardManagerMock.healthCheck.mockResolvedValue({ status: 'healthy', shards: ['shard-1', 'shard-2'] });
      const res = await request(app).get('/api/shards/status');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('healthy');
      expect(res.body.data.shards).toEqual(['shard-1', 'shard-2']);
      expect(res.body.timestamp).toBeDefined();
    });

    it('returns 401 when authentication fails', async () => {
      mockAuthenticate.mockImplementation((_req, res) => res.status(401).json({ error: 'Unauthorized' }));
      const res = await request(app).get('/api/shards/status');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 403 when user lacks shard:view policy', async () => {
      mockRequirePolicy.handler = (policy, _req, res) => {
        if (policy === 'shard:view') {
          return res.status(403).json({ error: 'Forbidden' });
        }
      };
      const res = await request(app).get('/api/shards/status');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('returns 500 when shardManager.healthCheck throws', async () => {
      shardManagerMock.healthCheck.mockRejectedValue(new Error('shard manager unavailable'));
      const res = await request(app).get('/api/shards/status');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/shards/location', () => {
    it('returns shard for valid coordinates', async () => {
      shardManagerMock.getShardForLocation.mockReturnValue('shard-us-west');
      const res = await request(app)
        .get('/api/shards/location')
        .query({ lat: '40.7128', lng: '-74.0060' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        shard: 'shard-us-west',
        lat: 40.7128,
        lng: -74.006,
      });
      expect(shardManagerMock.getShardForLocation).toHaveBeenCalledWith(40.7128, -74.006);
    });

    it('returns 400 when lat is missing or empty', async () => {
      const res1 = await request(app)
        .get('/api/shards/location')
        .query({ lng: '-74.0060' });
      expect(res1.status).toBe(400);
      expect(res1.body.success).toBe(false);
      expect(res1.body.error).toContain('lat required');

      const res2 = await request(app)
        .get('/api/shards/location')
        .query({ lat: '', lng: '-74.0060' });
      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error).toContain('lat required');
    });

    it('returns 400 when lng is missing or empty', async () => {
      const res1 = await request(app)
        .get('/api/shards/location')
        .query({ lat: '40.7128' });
      expect(res1.status).toBe(400);
      expect(res1.body.success).toBe(false);
      expect(res1.body.error).toContain('lng required');

      const res2 = await request(app)
        .get('/api/shards/location')
        .query({ lat: '40.7128', lng: '' });
      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error).toContain('lng required');
    });

    it('returns 400 when lat or lng is an array', async () => {
      const res = await request(app)
        .get('/api/shards/location?lat=40.7&lat=41.2&lng=-74.0');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('lat must be a single value');
    });

    it('returns 400 when lat is not a finite number', async () => {
      const res = await request(app)
        .get('/api/shards/location')
        .query({ lat: 'not-a-number', lng: '-74.0060' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('lat must be a finite number');
    });

    it('returns 400 when lng is not a finite number', async () => {
      const res = await request(app)
        .get('/api/shards/location')
        .query({ lat: '40.7128', lng: 'NaN' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('lng must be a finite number');
    });

    it('returns 400 when lat is out of range', async () => {
      const res = await request(app)
        .get('/api/shards/location')
        .query({ lat: '95', lng: '-74.0060' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('between -90 and 90');
    });

    it('returns 400 when lng is out of range', async () => {
      const res = await request(app)
        .get('/api/shards/location')
        .query({ lat: '40.7128', lng: '-200' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('between -180 and 180');
    });

    it('returns 500 when getShardForLocation throws an error', async () => {
      shardManagerMock.getShardForLocation.mockImplementation(() => {
        throw new Error('Topology computation failure');
      });
      const res = await request(app)
        .get('/api/shards/location')
        .query({ lat: '40.7128', lng: '-74.0060' });
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/shards/all/orders', () => {
    it('returns 200 OK when all shards succeed', async () => {
      const allSuccessResults = {
        results: [
          { shard: 'north', data: [{ total: '15' }] },
          { shard: 'south', data: [{ total: '25' }] },
        ],
        failed: [],
        healthy: ['north', 'south'],
        unhealthy: [],
        partial: false,
      };

      const customApp = makeApp((req, _res, next) => {
        req.executeCrossShard = vi.fn().mockResolvedValue(allSuccessResults);
        next();
      });

      const res = await request(customApp).get('/api/shards/all/orders');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(40);
      expect(res.body.data.shards).toEqual(allSuccessResults.results);
      expect(res.body.data.healthy).toEqual(['north', 'south']);
      expect(res.body.data.failedShards).toEqual([]);
      expect(res.body.data.partial).toBe(false);
    });

    it('returns 200 OK when healthy shards return zero rows (not 503)', async () => {
      const zeroRowResults = {
        results: [
          { shard: 'north', data: [] },
          { shard: 'south', data: [{ total: '0' }] },
        ],
        failed: [],
        healthy: ['north', 'south'],
        unhealthy: [],
        partial: false,
      };

      const customApp = makeApp((req, _res, next) => {
        req.executeCrossShard = vi.fn().mockResolvedValue(zeroRowResults);
        next();
      });

      const res = await request(customApp).get('/api/shards/all/orders');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.healthy).toEqual(['north', 'south']);
      expect(res.body.data.failedShards).toEqual([]);
      expect(res.body.data.partial).toBe(false);
    });

    it('aggregates total orders across shards and returns per-shard data when results are a raw array', async () => {
      const mockCrossShardResults = [
        { shard: 'shard-1', data: [{ total: '15' }] },
        { shard: 'shard-2', data: [{ total: '25' }] },
        { shard: 'shard-3', data: [] },
      ];

      const customApp = makeApp((req, _res, next) => {
        req.executeCrossShard = vi.fn().mockResolvedValue(mockCrossShardResults);
        next();
      });

      const res = await request(customApp).get('/api/shards/all/orders');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(40);
      expect(res.body.data.shards).toEqual(mockCrossShardResults);
    });

    it('returns 207 Multi-Status with partial flag and Retry-After when one or more shards fail while at least one shard succeeds', async () => {
      const partialCrossShardResults = {
        results: [
          { shard: 'north', data: [{ total: '15' }] },
          { shard: 'south', data: [{ total: '25' }] },
        ],
        failed: ['east', 'west'],
        healthy: ['north', 'south'],
        unhealthy: ['east', 'west'],
        partial: true,
      };

      const customApp = makeApp((req, _res, next) => {
        req.executeCrossShard = vi.fn().mockResolvedValue(partialCrossShardResults);
        next();
      });

      const res = await request(customApp).get('/api/shards/all/orders');
      expect(res.status).toBe(207);
      expect(res.body.success).toBe(false);
      expect(res.body.warning).toBe('results partially unavailable');
      expect(res.body.data.total).toBe(40);
      expect(res.body.data.failedShards).toEqual(['east', 'west']);
      expect(res.body.data.healthy).toEqual(['north', 'south']);
      expect(res.body.data.unhealthy).toEqual(['east', 'west']);
      expect(res.body.data.partial).toBe(true);
      expect(res.headers['retry-after']).toBe('30');
    });

    it('returns 503 Service Unavailable with Retry-After when all shards fail', async () => {
      const allFailedResults = {
        results: [],
        failed: ['north', 'south', 'east', 'west'],
        healthy: [],
        unhealthy: ['north', 'south', 'east', 'west'],
        partial: true,
      };

      const customApp = makeApp((req, _res, next) => {
        req.executeCrossShard = vi.fn().mockResolvedValue(allFailedResults);
        next();
      });

      const res = await request(customApp).get('/api/shards/all/orders');
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('All database shards are unavailable');
      expect(res.body.data.partial).toBe(true);
      expect(res.body.data.failedShards).toEqual(['north', 'south', 'east', 'west']);
      expect(res.headers['retry-after']).toBe('30');
    });

    it('returns 500 when executeCrossShard throws an error', async () => {
      const customApp = makeApp((req, _res, next) => {
        req.executeCrossShard = vi.fn().mockRejectedValue(new Error('Cross shard query timeout'));
        next();
      });

      const res = await request(customApp).get('/api/shards/all/orders');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/shards/:shardName/orders', () => {
    it('returns orders from the specified shard', async () => {
      const mockRows = [{ id: 'order-1' }, { id: 'order-2' }];
      shardManagerMock.executeQuery.mockResolvedValue(mockRows);
      const res = await request(app).get('/api/shards/shard-us-west/orders');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockRows);
      expect(res.body.shard).toBe('shard-us-west');
      expect(shardManagerMock.executeQuery).toHaveBeenCalledWith(
        'SELECT * FROM orders ORDER BY created_at DESC LIMIT 100',
        [],
        'shard-us-west'
      );
    });

    it('returns 500 when executeQuery throws', async () => {
      shardManagerMock.executeQuery.mockRejectedValue(new Error('db connection failed'));
      const res = await request(app).get('/api/shards/shard-us-west/orders');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });
});
