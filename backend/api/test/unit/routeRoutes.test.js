import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const { mockOsrm } = vi.hoisted(() => ({
  mockOsrm: {
    getRouteEstimate: vi.fn(),
    validateCoordinates: vi.fn(),
  },
}));

vi.mock('../../src/services/osrm.js', () => mockOsrm);

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import routeRoutes from '../../src/routes/routeRoutes.js';

function makeApp() {
  const app = express();
  app.use('/routes', routeRoutes);
  return app;
}

describe('routeRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOsrm.validateCoordinates.mockReturnValue(null);
    mockOsrm.getRouteEstimate.mockResolvedValue({ distanceKm: 12.5, durationSeconds: 900 });
  });

  describe('GET /routes/estimate', () => {
    it('returns 400 when coordinates are blank', async () => {
      const res = await request(makeApp()).get('/routes/estimate').query({ pickup_lat: '', pickup_lng: '', drop_lat: '', drop_lng: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid coordinates provided.');
    });

    it('returns 400 for partial blank coordinates', async () => {
      const res = await request(makeApp()).get('/routes/estimate').query({ pickup_lat: '12.3', pickup_lng: '77.6' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when coordinate validation fails', async () => {
      mockOsrm.validateCoordinates.mockReturnValue('lat must be between -90 and 90');
      const res = await request(makeApp()).get('/routes/estimate').query({ pickup_lat: '999', pickup_lng: '77.6', drop_lat: '12.3', drop_lng: '77.6' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('lat must be between -90 and 90');
    });

    it('returns the estimate on success', async () => {
      const res = await request(makeApp()).get('/routes/estimate').query({ pickup_lat: '12.3', pickup_lng: '77.6', drop_lat: '13.1', drop_lng: '80.2' });
      expect(res.status).toBe(200);
      expect(res.body.distance_km).toBe(12.5);
      expect(res.body.duration_hours).toBe(0.25);
    });

    it('returns 404 when no estimate is available', async () => {
      mockOsrm.getRouteEstimate.mockResolvedValue(null);
      const res = await request(makeApp()).get('/routes/estimate').query({ pickup_lat: '12.3', pickup_lng: '77.6', drop_lat: '13.1', drop_lng: '80.2' });
      expect(res.status).toBe(404);
    });

    it('returns 500 on internal error', async () => {
      mockOsrm.getRouteEstimate.mockRejectedValue(new Error('boom'));
      const res = await request(makeApp()).get('/routes/estimate').query({ pickup_lat: '12.3', pickup_lng: '77.6', drop_lat: '13.1', drop_lng: '80.2' });
      expect(res.status).toBe(500);
    });
  });
});
