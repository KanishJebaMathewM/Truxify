import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockAuthenticate = vi.fn((req, _res, next) => {
  req.user = { id: 'driver-123' };
  next();
});

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => mockAuthenticate(req, res, next),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  safeIpKeyGenerator: (req) => req.ip || '127.0.0.1',
  createStore: () => ({ increment: vi.fn(), decrement: vi.fn(), resetKey: vi.fn() }),
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (_req, _res, next) => next()),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockFrom = vi.fn();
vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabaseAdmin: {
    from: (...args) => mockFrom(...args),
  },
}));

import roadConditionRoutes from '../../src/routes/roadConditionRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/road-conditions', roadConditionRoutes);
  return app;
}

describe('roadConditionRoutes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockImplementation((req, _res, next) => {
      req.user = { id: 'driver-123' };
      next();
    });
    app = makeApp();
  });

  describe('POST /api/road-conditions/grip', () => {
    it('returns 401 when authentication fails', async () => {
      mockAuthenticate.mockImplementation((_req, res) => {
        return res.status(401).json({ error: 'Unauthorized' });
      });

      const res = await request(app)
        .post('/api/road-conditions/grip')
        .send({
          latitude: 19.076,
          longitude: 72.8777,
          grip_index: 0.85,
          slip_events_count: 0,
        });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    });

    it('successfully reports road grip data with valid payload', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ insert: mockInsert });

      const payload = {
        latitude: 19.076,
        longitude: 72.8777,
        grip_index: 0.85,
        slip_events_count: 2,
      };

      const res = await request(app)
        .post('/api/road-conditions/grip')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        message: 'Grip data reported successfully',
      });
      expect(mockFrom).toHaveBeenCalledWith('road_grip_reports');
      expect(mockInsert).toHaveBeenCalledWith({
        latitude: 19.076,
        longitude: 72.8777,
        grip_index: 0.85,
        slip_events_count: 2,
        user_id: 'driver-123',
      });
    });

    it('returns 400 when payload schema validation fails', async () => {
      const res = await request(app)
        .post('/api/road-conditions/grip')
        .send({
          latitude: 'invalid-latitude',
          longitude: 72.8777,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid payload');
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('returns 500 when database insertion fails', async () => {
      const mockInsert = vi.fn().mockResolvedValue({
        error: { message: 'DB connection timeout' },
      });
      mockFrom.mockReturnValue({ insert: mockInsert });

      const res = await request(app)
        .post('/api/road-conditions/grip')
        .send({
          latitude: 19.076,
          longitude: 72.8777,
          grip_index: 0.9,
          slip_events_count: 0,
        });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Database error' });
    });
  });

  describe('GET /api/road-conditions/grip/nearby', () => {
    it('returns 401 when authentication fails', async () => {
      mockAuthenticate.mockImplementation((_req, res) => {
        return res.status(401).json({ error: 'Unauthorized' });
      });

      const res = await request(app)
        .get('/api/road-conditions/grip/nearby')
        .query({ lat: 19.076, lng: 72.8777 });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    });

    it('successfully retrieves nearby grip data with valid coordinates', async () => {
      const mockReports = [
        {
          id: 'report-1',
          latitude: 19.08,
          longitude: 72.88,
          grip_index: 0.75,
          slip_events_count: 1,
          recorded_at: new Date().toISOString(),
        },
      ];

      const mockQueryChain = {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockReports, error: null }),
      };
      mockFrom.mockReturnValue(mockQueryChain);

      const res = await request(app)
        .get('/api/road-conditions/grip/nearby')
        .query({ lat: 19.076, lng: 72.8777, radius_miles: 25 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: mockReports,
      });
      expect(mockFrom).toHaveBeenCalledWith('road_grip_reports');
      expect(mockQueryChain.select).toHaveBeenCalledWith(
        'id, latitude, longitude, grip_index, slip_events_count, recorded_at'
      );
    });

    it('returns 400 when latitude or longitude is missing', async () => {
      const res1 = await request(app)
        .get('/api/road-conditions/grip/nearby')
        .query({ lng: 72.8777 });

      expect(res1.status).toBe(400);
      expect(res1.body.error).toContain('Latitude (lat) and longitude (lng) are required');

      const res2 = await request(app)
        .get('/api/road-conditions/grip/nearby')
        .query({ lat: 19.076 });

      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('Latitude (lat) and longitude (lng) are required');
    });

    it('returns 400 when latitude is invalid or out of range', async () => {
      const res = await request(app)
        .get('/api/road-conditions/grip/nearby')
        .query({ lat: 120, lng: 72.8777 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid latitude');
    });

    it('returns 400 when longitude is invalid or out of range', async () => {
      const res = await request(app)
        .get('/api/road-conditions/grip/nearby')
        .query({ lat: 19.076, lng: -200 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid longitude');
    });

    it('returns 400 when radius_miles is invalid', async () => {
      const res = await request(app)
        .get('/api/road-conditions/grip/nearby')
        .query({ lat: 19.076, lng: 72.8777, radius_miles: -10 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid radius_miles');
    });

    it('returns 500 when database query returns an error', async () => {
      const mockQueryChain = {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database read error' },
        }),
      };
      mockFrom.mockReturnValue(mockQueryChain);

      const res = await request(app)
        .get('/api/road-conditions/grip/nearby')
        .query({ lat: 19.076, lng: 72.8777 });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Database error' });
    });
  });
});
