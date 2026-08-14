import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1', role: 'admin' }; next(); },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
  safeIpKeyGenerator: () => 'test-ip',
  createStore: vi.fn(() => ({})),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return mockSupabase; },
  supabaseAdmin: undefined,
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
    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ data: [], error: null })),
        in: vi.fn(() => ({ data: [], error: null })),
        single: vi.fn(() => ({ data: null, error: null })),
      })),
      insert: vi.fn(() => ({ data: null, error: null })),
    });
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
  });

  describe('GET /shards/health', () => {
    it('returns healthy status', async () => {
      const res = await request(makeApp()).get('/shards/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /shards/route', () => {
    it('returns 400 when missing required params', async () => {
      const res = await request(makeApp()).get('/shards/route');
      expect(res.status).toBe(400);
    });

    it('returns shard info for valid input', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ data: { shard_key: 'shard-a' }, error: null })),
        })),
      });
      const res = await request(makeApp())
        .get('/shards/route')
        .query({ type: 'order', entityId: 'ent-123' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('shard');
    });
  });
});
