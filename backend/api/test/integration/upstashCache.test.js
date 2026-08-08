import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

let mockGetUser = vi.fn();
let mockGet = vi.fn();
let mockSet = vi.fn();
let mockDel = vi.fn();
let mockPredictPrice = vi.fn();
let mockPredictDemand = vi.fn();
let mockPredictEta = vi.fn();

// Mock database/config module
vi.mock('../../src/config/db.js', () => {
  const mockFrom = (table) => {
    if (table === 'driver_details') {
      return {
        select: () => ({
          eq: () => ({
            not: () => ({
              in: () => Promise.resolve({ data: [{ user_id: 'driver-1', rating: 4.8, total_trips: 10, completion_rate: 100, truck_id: 'truck-1' }], error: null })
            })
          })
        })
      };
    }
    if (table === 'trucks') {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [{ id: 'truck-1', name: 'Tata Ace', truck_type: 'Mini Truck', number_plate: 'MH12AB1234', max_capacity_tons: 1.5 }], error: null })
        })
      };
    }
    if (table === 'profiles') {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [{ id: 'driver-1', full_name: 'Tata Driver', avatar_url: '', is_digilocker_verified: true }], error: null }),
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: 'user-123', role: 'customer', is_active: true }, error: null })
            })
          })
        })
      };
    }
    return {};
  };

  return {
    supabase: {
      auth: {
        getUser: (...args) => mockGetUser(...args)
      },
      from: mockFrom
    },
    createUserClient: () => ({
      from: mockFrom
    }),
    redisClient: null,
    mongoDb: {
      collection: () => ({
        find: () => ({
          toArray: () => Promise.resolve([{ driver_id: 'driver-1' }])
        })
      })
    },
    upstashRedisClient: {
      get: (...args) => mockGet(...args),
      set: (...args) => mockSet(...args),
      del: (...args) => mockDel(...args)
    },
    firebaseAdmin: null
  };
});

// Mock traffic service
vi.mock('../../src/services/trafficService.js', () => ({
  getLiveTrafficMultiplier: () => Promise.resolve(1.0)
}));

// Mock ML service
vi.mock('../../src/services/ml.js', () => ({
  predictPrice: (...args) => mockPredictPrice(...args),
  predictDemand: (...args) => mockPredictDemand(...args),
  predictEta: (...args) => mockPredictEta(...args)
}));

// Mock osrm service for truck search
vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: () => Promise.resolve({ distanceKm: 15, durationSeconds: 1800 })
}));

const { default: truckRouter } = await import('../../src/routes/truckRoutes.js');
const { default: mlRouter } = await import('../../src/routes/mlRoutes.js');
const { invalidateBookingCaches, getTruckSearchVersion } = await import('../../src/utils/cacheInvalidation.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/trucks', truckRouter);
  app.use('/api/ml', mlRouter);
  app.use((err, req, res, next) => {
    console.error('EXPRESS ERROR:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  });
  return app;
}

describe('Upstash Redis Caching Layer', () => {
  let app;
  let token;
  let cacheStore;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    process.env.BYPASS_AUTH = 'false';
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });
    token = jwt.sign({ iss: 'https://xyz.supabase.co' }, 'secret');

    // In-memory simple store to mock Upstash Redis behavior
    cacheStore = {};
    mockGet.mockImplementation(async (key) => cacheStore[key] || null);
    mockSet.mockImplementation(async (key, value, options) => {
      cacheStore[key] = value;
      return 'OK';
    });
    mockDel.mockImplementation(async (key) => {
      delete cacheStore[key];
      return 1;
    });

    mockPredictDemand.mockResolvedValue({ predicted_demand: 0.8 });
    mockPredictPrice.mockResolvedValue({ estimated_price: 12000, currency: 'INR', estimatedPricePaisa: 1200000 });
    mockPredictEta.mockResolvedValue({ eta_minutes: 18, confidence_interval: { lower: 15, upper: 22 } });
  });

  describe('GET /api/trucks/search', () => {
    it('returns X-Cache: MISS on first request, caches the response, and returns HIT on second', async () => {
      const res1 = await request(app)
        .get('/api/trucks/search?pickup_lat=12.9716&pickup_lng=77.5946&drop_lat=13.0827&drop_lng=80.2707&weight_tonnes=5')
        .set('Authorization', `Bearer ${token}`);

      expect(res1.status).toBe(200);
      expect(res1.headers['x-cache']).toBe('MISS');
      expect(mockSet).toHaveBeenCalled();

      const res2 = await request(app)
        .get('/api/trucks/search?pickup_lat=12.9716&pickup_lng=77.5946&drop_lat=13.0827&drop_lng=80.2707&weight_tonnes=5')
        .set('Authorization', `Bearer ${token}`);

      expect(res2.status).toBe(200);
      expect(res2.headers['x-cache']).toBe('HIT');
    });

    it('returns HIT on query parameters with different sorting order', async () => {
      await request(app)
        .get('/api/trucks/search?pickup_lat=12.9716&pickup_lng=77.5946&drop_lat=13.0827&drop_lng=80.2707&weight_tonnes=5')
        .set('Authorization', `Bearer ${token}`);

      const res = await request(app)
        .get('/api/trucks/search?weight_tonnes=5&drop_lng=80.2707&drop_lat=13.0827&pickup_lng=77.5946&pickup_lat=12.9716')
        .set('Authorization', `Bearer ${token}`);

      expect(res.headers['x-cache']).toBe('HIT');
    });

    it('invalidates cache after invalidateBookingCaches is called', async () => {
      await request(app)
        .get('/api/trucks/search?pickup_lat=12.9716&pickup_lng=77.5946&drop_lat=13.0827&drop_lng=80.2707&weight_tonnes=5')
        .set('Authorization', `Bearer ${token}`);

      // Invalidate caches
      await invalidateBookingCaches();

      const res = await request(app)
        .get('/api/trucks/search?pickup_lat=12.9716&pickup_lng=77.5946&drop_lat=13.0827&drop_lng=80.2707&weight_tonnes=5')
        .set('Authorization', `Bearer ${token}`);

      expect(res.headers['x-cache']).toBe('MISS');
    });
  });

  describe('GET /api/ml/demand-heatmap', () => {
    it('caches demand heatmap with 5 minute TTL', async () => {
      const res1 = await request(app)
        .get('/api/ml/demand-heatmap?zoneId=zone-A')
        .set('Authorization', `Bearer ${token}`);

      expect(res1.status).toBe(200);
      expect(res1.headers['x-cache']).toBe('MISS');
      expect(mockPredictDemand).toHaveBeenCalled();

      const res2 = await request(app)
        .get('/api/ml/demand-heatmap?zoneId=zone-A')
        .set('Authorization', `Bearer ${token}`);

      expect(res2.status).toBe(200);
      expect(res2.headers['x-cache']).toBe('HIT');
    });
  });

  describe('GET /api/ml/price-forecast', () => {
    it('caches price forecast with 10 minute TTL', async () => {
      const res1 = await request(app)
        .get('/api/ml/price-forecast?origin=BLR&destination=MAA&date=2026-08-10')
        .set('Authorization', `Bearer ${token}`);

      expect(res1.status).toBe(200);
      expect(res1.headers['x-cache']).toBe('MISS');
      expect(mockPredictPrice).toHaveBeenCalled();

      const res2 = await request(app)
        .get('/api/ml/price-forecast?origin=BLR&destination=MAA&date=2026-08-10')
        .set('Authorization', `Bearer ${token}`);

      expect(res2.status).toBe(200);
      expect(res2.headers['x-cache']).toBe('HIT');
    });
  });

  describe('GET /api/ml/eta', () => {
    it('caches ETA with 10 second TTL using tripId + GPS bucket', async () => {
      const res1 = await request(app)
        .get('/api/ml/eta?tripId=trip-123&lat=12.97159&lng=77.59456')
        .set('Authorization', `Bearer ${token}`);

      expect(res1.status).toBe(200);
      expect(res1.headers['x-cache']).toBe('MISS');
      expect(mockPredictEta).toHaveBeenCalled();

      // Same GPS bucket (rounded to 4 decimals: 12.9716, 77.5946)
      const res2 = await request(app)
        .get('/api/ml/eta?tripId=trip-123&lat=12.97161&lng=77.59463')
        .set('Authorization', `Bearer ${token}`);

      expect(res2.status).toBe(200);
      expect(res2.headers['x-cache']).toBe('HIT');

      // Different GPS bucket (rounded to 4 decimals is different)
      const res3 = await request(app)
        .get('/api/ml/eta?tripId=trip-123&lat=12.97500&lng=77.59463')
        .set('Authorization', `Bearer ${token}`);

      expect(res3.status).toBe(200);
      expect(res3.headers['x-cache']).toBe('MISS');
    });
  });
});
