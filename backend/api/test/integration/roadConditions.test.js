import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { supabaseAdmin } from '../../../src/config/db.js';
import roadConditionRoutes from '../../../src/routes/roadConditionRoutes.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { generateTestToken } from '../../helpers/auth.js';

// Mock DB
vi.mock('../../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnThis(),
    insert: vi.fn(),
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  },
  supabase: {}
}));

// Setup app
const app = express();
app.use(express.json());
app.use('/api/road-conditions', roadConditionRoutes);
app.use(errorHandler);

describe('Road Condition Routes Integration', () => {
  const driverToken = generateTestToken({ id: 'driver-123', role: 'driver' });
  const adminToken = generateTestToken({ id: 'admin-1', role: 'admin' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/road-conditions/grip', () => {
    it('should successfully report grip data', async () => {
      supabaseAdmin.insert.mockResolvedValueOnce({ error: null });

      const res = await request(app)
        .post('/api/road-conditions/grip')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          latitude: 45.0,
          longitude: -90.0,
          grip_index: 3,
          slip_events_count: 5
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(supabaseAdmin.insert).toHaveBeenCalledWith(expect.objectContaining({
        latitude: 45.0,
        longitude: -90.0,
        grip_index: 3,
        slip_events_count: 5,
        user_id: 'driver-123'
      }));
    });

    it('should fail with invalid grip_index', async () => {
      const res = await request(app)
        .post('/api/road-conditions/grip')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          latitude: 45.0,
          longitude: -90.0,
          grip_index: 15 // Max is 10
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid payload');
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/road-conditions/grip')
        .send({
          latitude: 45.0,
          longitude: -90.0,
          grip_index: 5
        });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/road-conditions/grip/nearby', () => {
    it('should return nearby grip data', async () => {
      const mockData = [
        { id: '1', latitude: 45.1, longitude: -90.1, grip_index: 2, slip_events_count: 10 }
      ];
      supabaseAdmin.limit.mockResolvedValueOnce({ data: mockData, error: null });

      const res = await request(app)
        .get('/api/road-conditions/grip/nearby')
        .set('Authorization', `Bearer ${driverToken}`)
        .query({ lat: 45.0, lng: -90.0, radius_miles: 50 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockData);
      expect(supabaseAdmin.select).toHaveBeenCalled();
      expect(supabaseAdmin.gte).toHaveBeenCalledWith('latitude', expect.any(Number));
      expect(supabaseAdmin.lte).toHaveBeenCalledWith('latitude', expect.any(Number));
    });

    it('should require lat and lng', async () => {
      const res = await request(app)
        .get('/api/road-conditions/grip/nearby')
        .set('Authorization', `Bearer ${driverToken}`)
        .query({ lat: 45.0 }); // Missing lng

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Latitude (lat) and longitude (lng) are required');
    });
  });
});
