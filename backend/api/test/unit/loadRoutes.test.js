import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (req, _res, next) => { req.body = req.body || {}; next(); },
  validateParams: () => (_req, _res, next) => next(),
  validateQuery: () => (_req, _res, next) => next(),
}));

const { dbMock } = vi.hoisted(() => ({
  dbMock: { supabaseAdmin: { from: vi.fn() } },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return dbMock.supabaseAdmin; },
  get supabase() { return null; },
}));

vi.mock('../../src/lib/escapeLike.js', () => ({
  escapeLike: (v) => v,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import loadRoutes from '../../src/routes/loadRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/loads', loadRoutes);
  return app;
}

function chain(result) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    ilike: vi.fn(() => q),
    gte: vi.fn(() => q),
    lte: vi.fn(() => q),
    or: vi.fn(() => q),
    order: vi.fn(() => q),
    range: vi.fn(() => q),
    in: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return q;
}

describe('loadRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /loads/', () => {
    it('returns 400 when page is not numeric', async () => {
      const res = await request(makeApp()).get('/loads/').query({ page: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('page must be a valid integer');
    });

    it('returns 400 when limit is out of range', async () => {
      const res = await request(makeApp()).get('/loads/').query({ limit: '500' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('limit must be between 1 and 100');
    });

    it('returns 400 when vehicle_type is not truck-like', async () => {
      const res = await request(makeApp()).get('/loads/').query({ vehicle_type: 'motorcycle' });
      expect(res.status).toBe(200);
      expect(res.body.loads).toEqual([]);
    });

    it('returns formatted loads on success', async () => {
      const q = chain({ data: [{ id: 'l1', pickup_address: 'A', drop_address: 'B', freight_value: 10000 }], error: null, count: 1 });
      q.range.mockResolvedValue({ data: [{ id: 'l1', pickup_address: 'A', drop_address: 'B', freight_value: 10000 }], error: null, count: 1 });
      dbMock.supabaseAdmin.from.mockReturnValue(q);
      const res = await request(makeApp()).get('/loads/');
      expect(res.status).toBe(200);
      expect(res.body.loads[0].pickup).toBe('A');
      expect(res.body.loads[0].estimated_price).toBe(100);
    });

    it('returns 500 when the query errors', async () => {
      const q = chain({ data: null, error: { message: 'db down' }, count: 0 });
      dbMock.supabaseAdmin.from.mockReturnValue(q);
      q.range.mockResolvedValue({ data: null, error: { message: 'db down' }, count: 0 });
      const res = await request(makeApp()).get('/loads/');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch load offers.');
    });
  });

  describe('GET /loads/:id', () => {
    it('returns 404 when the load is not found', async () => {
      const q = chain({ data: null, error: null });
      q.maybeSingle.mockResolvedValue({ data: null, error: null });
      dbMock.supabaseAdmin.from.mockReturnValue(q);
      const res = await request(makeApp()).get('/loads/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
