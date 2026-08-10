import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  deviceLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (req, _res, next) => { req.body = req.body || {}; next(); },
}));

const { dbMock } = vi.hoisted(() => ({
  dbMock: { supabase: { from: vi.fn() } },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock.supabase; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import userRoutes from '../../src/routes/userRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/users', userRoutes);
  return app;
}

describe('userRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /users/fcm-token', () => {
    it('returns success when the update succeeds', async () => {
      dbMock.supabase.from.mockReturnValue({
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      });
      const res = await request(makeApp())
        .post('/users/fcm-token')
        .send({ fcmToken: 'valid-token-12345' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 500 when the update errors', async () => {
      dbMock.supabase.from.mockReturnValue({
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: { message: 'db down' } }) })),
      });
      const res = await request(makeApp())
        .post('/users/fcm-token')
        .send({ fcmToken: 'valid-token-12345' });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to update FCM token.');
    });
  });
});
