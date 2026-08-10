import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => next(),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
  safeIpKeyGenerator: () => 'test-ip',
  createStore: vi.fn(() => ({})),
}));

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return mockSupabase; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/auditLog.js', () => ({
  auditLog: () => (_req, _res, next) => next(),
}));

import adminRoutes from '../../src/routes/adminRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRoutes);
  return app;
}

describe('adminRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /admin/dashboard', () => {
    it('returns dashboard stats on success', async () => {
      // profiles count query
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ count: 5, error: null })) })) })),
      });
      // orders pending count query
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(async () => ({ count: 3, error: null })) })),
      });
      // revenue query
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({ gte: vi.fn(() => ({ in: vi.fn(async () => ({ data: [{ total_amount: 100 }, { total_amount: 200 }], error: null })) })) })),
      });

      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        active_drivers: 5,
        pending_orders: 3,
        total_revenue_today: 300,
      });
    });

    it('returns 500 when the drivers query errors', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ count: null, error: { message: 'db down' } })) })) })),
      });
      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch drivers count.');
    });
  });
});
