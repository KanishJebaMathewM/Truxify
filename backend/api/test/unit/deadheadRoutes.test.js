import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => next(),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (req, _res, next) => { req.body = req.body || {}; next(); },
}));

const { mlMock } = vi.hoisted(() => ({
  mlMock: { matchDeadhead: vi.fn() },
}));

vi.mock('../../src/services/ml.js', () => mlMock);

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import deadheadRoutes from '../../src/routes/deadheadRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/deadhead', deadheadRoutes);
  return app;
}

describe('deadheadRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mlMock.matchDeadhead.mockResolvedValue({ matches: [] });
  });

  describe('POST /deadhead/match/deadhead', () => {
    it('returns the match result on success', async () => {
      mlMock.matchDeadhead.mockResolvedValue({ matches: [{ id: 't1' }] });
      const res = await request(makeApp())
        .post('/deadhead/match/deadhead')
        .send({ driver_destination: 'Mumbai', truck_specs: {}, arrival_time: '2026-08-10T10:00:00Z', available_loads: [] });
      expect(res.status).toBe(200);
      expect(res.body.matches).toEqual([{ id: 't1' }]);
    });

    it('returns 503 when the ML engine is unavailable', async () => {
      mlMock.matchDeadhead.mockRejectedValue(new Error('[ML] engine down'));
      const res = await request(makeApp())
        .post('/deadhead/match/deadhead')
        .send({ driver_destination: 'Mumbai' });
      expect(res.status).toBe(503);
      expect(res.body.error).toContain('temporarily unavailable');
    });

    it('returns 500 on unexpected errors', async () => {
      mlMock.matchDeadhead.mockRejectedValue(new Error('boom'));
      const res = await request(makeApp())
        .post('/deadhead/match/deadhead')
        .send({ driver_destination: 'Mumbai' });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Deadhead matching failed.');
    });
  });
});
