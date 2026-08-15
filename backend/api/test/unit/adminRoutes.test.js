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
  supabaseAdmin: undefined,
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

describe('adminRoutes - additional cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /admin/dashboard - error handling', () => {
    it('returns 500 when the pending_orders query errors', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ count: 5, error: null })) })) })),
      });
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(async () => ({ count: null, error: { message: 'orders table down' } })) })),
      });
      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch pending orders.');
    });

    it('returns 500 when the revenue query errors', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ count: 5, error: null })) })) })),
      });
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(async () => ({ count: 3, error: null })) })),
      });
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({ gte: vi.fn(() => ({ in: vi.fn(async () => ({ data: null, error: { message: 'revenue query failed' } })) })) })),
      });
      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch revenue.');
    });
  });
});
