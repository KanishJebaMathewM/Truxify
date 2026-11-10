import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

const { mockOsrm } = vi.hoisted(() => ({
  mockOsrm: {
    getRouteEstimate: vi.fn(),
  },
}));

vi.mock('../../src/services/osrm.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getRouteEstimate: (...args) => mockOsrm.getRouteEstimate(...args),
  };
});

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import routeRoutes from '../../src/routes/routeRoutes.js';

function makeApp() {
  const app = express();
  app.use('/api/routes', routeRoutes);
  return app;
}

describe('routeCoordinateValidation - /api/routes/estimate route validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOsrm.getRouteEstimate.mockResolvedValue({ distanceKm: 15.2, durationSeconds: 1200 });
  });

  describe('valid coordinates', () => {
    it('accepts valid positive coordinates', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '28.6139', pickup_lng: '77.2090', drop_lat: '28.7041', drop_lng: '77.1025' });

      expect(res.status).toBe(200);
      expect(res.body.distance_km).toBe(15.2);
      expect(mockOsrm.getRouteEstimate).toHaveBeenCalledWith({
        pickupLat: 28.6139,
        pickupLng: 77.2090,
        dropLat: 28.7041,
        dropLng: 77.1025,
      });
    });

    it('accepts valid negative coordinates', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '-33.8688', pickup_lng: '151.2093', drop_lat: '-37.8136', drop_lng: '144.9631' });

      expect(res.status).toBe(200);
      expect(mockOsrm.getRouteEstimate).toHaveBeenCalledTimes(1);
    });

    it('accepts 0 for both lat and lng', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '0', pickup_lng: '0', drop_lat: '0', drop_lng: '10' });

      expect(res.status).toBe(200);
      expect(mockOsrm.getRouteEstimate).toHaveBeenCalledWith(
        expect.objectContaining({ pickupLat: 0, pickupLng: 0 })
      );
    });

    it('accepts exact boundary coordinates (-90, 90, -180, 180)', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '-90', pickup_lng: '-180', drop_lat: '90', drop_lng: '180' });

      expect(res.status).toBe(200);
      expect(mockOsrm.getRouteEstimate).toHaveBeenCalledTimes(1);
    });
  });

  describe('out-of-bounds geographic rejection BEFORE route calculation (Rule 1 & 4)', () => {
    it('rejects pickup_lat > 90 with 400 and clear field-specific message', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '95', pickup_lng: '77.2', drop_lat: '28.7', drop_lng: '77.1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('pickup_lat must be between -90 and 90');
      expect(mockOsrm.getRouteEstimate).not.toHaveBeenCalled();
    });

    it('rejects pickup_lat < -90 with 400', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '-91', pickup_lng: '77.2', drop_lat: '28.7', drop_lng: '77.1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('pickup_lat must be between -90 and 90');
      expect(mockOsrm.getRouteEstimate).not.toHaveBeenCalled();
    });

    it('rejects drop_lat > 90 with 400 and clear field-specific message', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '28.6', pickup_lng: '77.2', drop_lat: '90.5', drop_lng: '77.1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('drop_lat must be between -90 and 90');
      expect(mockOsrm.getRouteEstimate).not.toHaveBeenCalled();
    });

    it('rejects drop_lat < -90 with 400', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '28.6', pickup_lng: '77.2', drop_lat: '-95', drop_lng: '77.1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('drop_lat must be between -90 and 90');
      expect(mockOsrm.getRouteEstimate).not.toHaveBeenCalled();
    });

    it('rejects pickup_lng < -180 with 400 and clear field-specific message', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '28.6', pickup_lng: '-200', drop_lat: '28.7', drop_lng: '77.1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('pickup_lng must be between -180 and 180');
      expect(mockOsrm.getRouteEstimate).not.toHaveBeenCalled();
    });

    it('rejects drop_lng > 180 with 400 and clear field-specific message', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '28.6', pickup_lng: '77.2', drop_lat: '28.7', drop_lng: '185' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('drop_lng must be between -180 and 180');
      expect(mockOsrm.getRouteEstimate).not.toHaveBeenCalled();
    });
  });

  describe('invalid type and missing coordinate rejection (Rule 3)', () => {
    it('rejects non-numeric string coordinate values', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: 'abc', pickup_lng: '77.2', drop_lat: '28.7', drop_lng: '77.1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid coordinates provided.');
      expect(mockOsrm.getRouteEstimate).not.toHaveBeenCalled();
    });

    it('rejects empty string coordinates', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '', pickup_lng: '77.2', drop_lat: '28.7', drop_lng: '77.1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid coordinates provided.');
      expect(mockOsrm.getRouteEstimate).not.toHaveBeenCalled();
    });

    it('rejects missing coordinates', async () => {
      const res = await request(makeApp())
        .get('/api/routes/estimate')
        .query({ pickup_lat: '28.6', pickup_lng: '77.2' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid coordinates provided.');
      expect(mockOsrm.getRouteEstimate).not.toHaveBeenCalled();
    });
  });
});
