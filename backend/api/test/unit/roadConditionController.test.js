import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      insert: vi.fn(() => Promise.resolve({ error: null })),
      select: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
  },
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { reportGripData, getNearbyGripData } from '../../../../src/controllers/roadConditionController.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.post('/grip', reportGripData);
  app.get('/grip/nearby', getNearbyGripData);
  return app;
}

describe('roadConditionController', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
  });

  describe('reportGripData', () => {
    it('returns 400 for invalid payload', async () => {
      const res = await request(app)
        .post('/grip')
        .send({ latitude: 'invalid' });
      expect(res.status).toBe(400);
    });
  });

  describe('getNearbyGripData', () => {
    it('returns 400 when lat is missing', async () => {
      const res = await request(app)
        .get('/grip/nearby')
        .query({ lng: 72.8777 });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid latitude', async () => {
      const res = await request(app)
        .get('/grip/nearby')
        .query({ lat: 999, lng: 72.8777 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('latitude');
    });

    it('returns 400 for invalid longitude', async () => {
      const res = await request(app)
        .get('/grip/nearby')
        .query({ lat: 19.076, lng: 999 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('longitude');
    });

    it('returns 400 for invalid radius_miles', async () => {
      const res = await request(app)
        .get('/grip/nearby')
        .query({ lat: 19.076, lng: 72.8777, radius_miles: -5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('radius_miles');
    });
  });
});
