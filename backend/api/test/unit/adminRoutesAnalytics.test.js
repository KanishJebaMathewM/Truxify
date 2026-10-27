import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { adminDb, mongoDbMock } = vi.hoisted(() => {
  const from = vi.fn((table) => {
    return {
      select: vi.fn(() => ({
        gte: vi.fn(() => ({
          lt: vi.fn(async () => ({ count: 5, data: [{ total_amount: 100000, created_at: new Date().toISOString() }], error: null })),
          or: vi.fn(async () => ({ count: 1, data: [], error: null })),
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
        or: vi.fn(async () => ({ count: 2, error: null })),
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ count: 10, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({
              data: [
                {
                  id: 'ord-101',
                  order_display_id: 'TRX-101',
                  pickup_address: 'Delhi',
                  drop_address: 'Jaipur',
                  estimated_delivery_at: new Date(Date.now() - 3600000).toISOString(),
                  updated_at: new Date(Date.now() - 3000000).toISOString(),
                  created_at: new Date(Date.now() - 7200000).toISOString(),
                  status: 'delivered',
                },
              ],
              error: null,
            })),
          })),
        })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      })),
    };
  });

  const mongoDb = {
    collection: vi.fn(() => ({
      distinct: vi.fn(async () => ['drv-1', 'drv-2']),
      aggregate: vi.fn(() => ({
        toArray: vi.fn(async () => [
          {
            _id: 'drv-1',
            lat: 28.6139,
            lng: 77.209,
            speed_kmh: 40,
            timestamp: new Date().toISOString(),
          },
        ]),
      })),
    })),
  };

  return { adminDb: { from }, mongoDbMock: mongoDb };
});

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    if (req.headers['x-mock-unauthenticated'] === 'true') {
      return _res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { id: 'admin-user-id', role: req.headers['x-mock-role'] || 'admin' };
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (req, res, next) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    next();
  },
}));

vi.mock('../../src/middleware/auditLog.js', () => ({
  auditLog: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => ({
  getAdminClient: () => adminDb,
  mongoDb: mongoDbMock,
  supabaseAdmin: null,
  supabase: null,
}));

import adminRouter from '../../src/routes/adminRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin Routes - GET /api/admin/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retrieves analytics metrics for an admin user', async () => {
    const response = await request(makeApp())
      .get('/api/admin/analytics?period=7d')
      .set('x-mock-role', 'admin');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('period', '7d');
    expect(response.body).toHaveProperty('overview');
    expect(response.body.overview).toHaveProperty('total_bookings_today');
    expect(response.body.overview).toHaveProperty('gross_revenue_today');
    expect(response.body.overview).toHaveProperty('active_drivers_24h');
    expect(response.body.overview).toHaveProperty('open_disputes');

    expect(response.body).toHaveProperty('booking_volume');
    expect(Array.isArray(response.body.booking_volume)).toBe(true);
    expect(response.body.booking_volume.length).toBe(7);

    expect(response.body).toHaveProperty('revenue_trend');
    expect(Array.isArray(response.body.revenue_trend)).toBe(true);
    expect(response.body.revenue_trend.length).toBe(30);

    expect(response.body).toHaveProperty('active_drivers_map');
    expect(response.body.active_drivers_map).toHaveProperty('regions');
    expect(response.body.active_drivers_map).toHaveProperty('points');

    expect(response.body).toHaveProperty('dispute_metrics');
    expect(response.body.dispute_metrics).toHaveProperty('dispute_rate_pct');

    expect(response.body).toHaveProperty('ml_accuracy');
    expect(response.body.ml_accuracy).toHaveProperty('trips_evaluated');
    expect(response.body.ml_accuracy).toHaveProperty('mae_minutes');
    expect(response.body.ml_accuracy).toHaveProperty('within_15m_pct');
    expect(Array.isArray(response.body.ml_accuracy.trips)).toBe(true);
  });

  it('returns 401 when unauthenticated', async () => {
    const response = await request(makeApp())
      .get('/api/admin/analytics')
      .set('x-mock-unauthenticated', 'true');

    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    const response = await request(makeApp())
      .get('/api/admin/analytics')
      .set('x-mock-role', 'driver');

    expect(response.status).toBe(403);
  });
});
