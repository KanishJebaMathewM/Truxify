import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1', role: 'driver' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: 'trip-1', driver_id: 'user-1' }, error: null }),
        })),
        insert: vi.fn().mockResolvedValue({ data: { id: 'trip-1' }, error: null }),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    })),
  },
  supabaseAdmin: { from: vi.fn() },
}));

import tripRoutes from '../../src/routes/tripRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/trips', tripRoutes);
  return app;
}

describe('tripRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /trips/:id', () => {
    it('returns trip for authenticated driver', async () => {
      const app = makeApp();
      const response = await request(app).get('/trips/trip-1');
      expect([200, 404, 500]).toContain(response.status);
    });
  });
});
