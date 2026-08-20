import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let authAllowed = true;
let policyAllowed = true;

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    if (!authAllowed) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = { id: 'admin-1', role: 'admin' };
    next();
  },
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
  requirePolicy: (policyName) => (_req, res, next) => {
    if (!policyAllowed) {
      return res.status(403).json({ error: `Forbidden - missing policy ${policyName}` });
    }
    next();
  },
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
    authAllowed = true;
    policyAllowed = true;
  });

  describe('GET /admin/dashboard - authorization', () => {
    it('returns 401 when request is unauthenticated', async () => {
      authAllowed = false;
      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication required');
    });

    it('returns 403 when user lacks admin dashboard policy', async () => {
      policyAllowed = false;
      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });
  });

  describe('GET /admin/dashboard - aggregate stats calculation', () => {
    it('returns 200 with aggregated dashboard metrics and revenue in INR', async () => {
      // 1. active drivers query
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ count: 12, error: null })),
          })),
        })),
      });

      // 2. pending orders query
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ count: 4, error: null })),
        })),
      });

      // 3. revenue query (in paisa: 250000 paisa + 150000 paisa = 400000 paisa = 4000 INR)
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          gte: vi.fn(() => ({
            in: vi.fn(async () => ({
              data: [{ total_amount: 250000 }, { total_amount: 150000 }],
              error: null,
            })),
          })),
        })),
      });

      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        active_drivers: 12,
        pending_orders: 4,
        total_revenue_today: 4000,
      });
    });

    it('handles zero counts and empty revenue data gracefully', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ count: 0, error: null })),
          })),
        })),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ count: 0, error: null })),
        })),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          gte: vi.fn(() => ({
            in: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
      });

      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        active_drivers: 0,
        pending_orders: 0,
        total_revenue_today: 0,
      });
    });
  });

  describe('GET /admin/dashboard - error handling', () => {
    it('returns 500 when active drivers query fails', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ count: null, error: { message: 'profiles query timeout' } })),
          })),
        })),
      });

      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch drivers count.');
    });

    it('returns 500 when pending orders query fails', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ count: 5, error: null })),
          })),
        })),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ count: null, error: { message: 'orders table down' } })),
        })),
      });

      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch pending orders.');
    });

    it('returns 500 when revenue query fails', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ count: 5, error: null })),
          })),
        })),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ count: 3, error: null })),
        })),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          gte: vi.fn(() => ({
            in: vi.fn(async () => ({ data: null, error: { message: 'revenue query failed' } })),
          })),
        })),
      });

      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch revenue.');
    });

    it('returns 500 when unexpected runtime exception occurs', async () => {
      mockSupabase.from.mockImplementationOnce(() => {
        throw new Error('Unexpected crash');
      });

      const res = await request(makeApp()).get('/admin/dashboard');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });
});
