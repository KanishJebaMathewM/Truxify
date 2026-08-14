import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
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
  mockSupabase: { from: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return mockSupabase; },
  supabaseAdmin: undefined,
}));

import roadConditionRoutes from '../../src/routes/roadConditionRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/road-conditions', roadConditionRoutes);
  return app;
}

describe('roadConditionRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /road-conditions', () => {
    it('returns 400 when lat/lng are missing', async () => {
      const res = await request(makeApp()).get('/road-conditions');
      expect(res.status).toBe(400);
    });

    it('returns road conditions for valid coordinates', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({
              data: { conditions: 'clear', updated_at: new Date().toISOString() },
              error: null,
            })),
          })),
        })),
      });
      const res = await request(makeApp())
        .get('/road-conditions')
        .query({ lat: '19.076', lng: '72.8777' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('conditions');
    });

    it('returns 500 when the database query fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({ data: null, error: { message: 'DB error' } })),
          })),
        })),
      });
      const res = await request(makeApp())
        .get('/road-conditions')
        .query({ lat: '19.076', lng: '72.8777' });
      expect(res.status).toBe(500);
    });
  });
});
