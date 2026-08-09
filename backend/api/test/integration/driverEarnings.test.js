import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import driverRoutes from '../../src/routes/driverRoutes.js';
import { supabase } from '../../src/config/db.js';
import { authenticate } from '../../src/middleware/auth.js';
import { userLimiter } from '../../src/middleware/rateLimiter.js';
import { requirePolicy } from '../../src/middleware/requirePolicy.js';

// Mock dependencies
vi.mock('../../src/config/db.js', () => {
  return {
    supabase: {
      from: vi.fn(),
    },
    redisClient: {
      get: vi.fn(),
      set: vi.fn(),
    },
    createUserClient: vi.fn()
  };
});

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'driver-123', role: 'driver' };
    req.token = 'mock-token';
    next();
  }
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (req, res, next) => next(),
  createStore: vi.fn()
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (req, res, next) => next()
}));

// Shared mock trip data
const mockTrips = [
  {
    trip_date: new Date().toISOString(),
    total_earnings: 1000,
    net_earnings: 800,
    distance: '50 km',
    route_label: 'Mumbai-Pune',
  },
  {
    trip_date: new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toISOString(),
    total_earnings: 500,
    net_earnings: 400,
    distance: '30.5 km',
    route_label: 'Delhi-Jaipur',
  },
];

const mockAllTrips = [
  {
    trip_date: new Date().toISOString(),
    distance: '25 km',
    route_label: 'Mumbai-Pune',
  },
  {
    trip_date: new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toISOString(),
    distance: '40 km',
    route_label: 'Delhi-Jaipur',
  },
];

// Setup app
const app = express();
app.use(express.json());
app.use('/api/driver', driverRoutes);

describe('GET /api/driver/:id/earnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes weekly earnings with deadhead savings', async () => {
    let deadheadChain = null;
    
    // Track which 'from' was called
    supabase.from.mockImplementation((table) => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: function(resolve) {
          const selectArgs = this.select.mock.calls[0][0];
          if (selectArgs.includes('distance')) {
            resolve({ data: mockTrips, error: null });
          } else if (selectArgs === '*' && this.select.mock.calls[0][1]?.count === 'exact') {
            resolve({ count: 10, error: null });
          } else if (selectArgs.includes('route_label, trip_date')) {
            deadheadChain = this;
            resolve({ data: mockAllTrips, error: null });
          } else {
            resolve({ data: [], error: null });
          }
        }
      };
      return chain;
    });

    const res = await request(app).get('/api/driver/driver-123/earnings?period=week');

    expect(res.status).toBe(200);
    expect(res.body.gross_earnings).toBe(1000);
    expect(res.body.net_earnings).toBe(800);
    expect(res.body.cumulative_stats.total_km).toBe(50);
    expect(res.body.cumulative_stats.lifetime_trips).toBe(10);
    expect(res.body.deadhead_trips_saved).toBe(1);

    // Verify the deadhead query cap
    expect(deadheadChain).not.toBeNull();
    expect(deadheadChain.limit).toHaveBeenCalledWith(300);
  });
});
