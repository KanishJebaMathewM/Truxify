import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { adminDb } = vi.hoisted(() => {
  const chains = {
    profiles: { count: 12, error: null },
    orders: { count: 5, error: null },
    revenue: { data: [{ total_amount: 1500000 }], error: null },
  };
  const from = vi.fn((table) => {
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ count: chains.profiles.count, error: chains.profiles.error })),
          })),
        })),
      };
    }
    return {
      select: vi.fn((cols) => {
        if (cols === 'total_amount') {
          return {
            gte: vi.fn(() => ({
              in: vi.fn(async () => ({ data: chains.revenue.data, error: chains.revenue.error })),
            })),
          };
        }
        return {
          eq: vi.fn(async () => ({ count: chains.orders.count, error: chains.orders.error })),
        };
      }),
    };
  });
  return { adminDb: { from }, chains };
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
  supabaseAdmin: null,
  supabase: null,
}));

import adminRouter from '../../src/routes/adminRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
}

describe('Admin Routes - GET /dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully retrieve dashboard stats for an admin user', async () => {
    const response = await request(makeApp())
      .get('/admin/dashboard')
      .set('x-mock-role', 'admin');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('active_drivers', 12);
    expect(response.body).toHaveProperty('pending_orders', 5);
    expect(response.body).toHaveProperty('total_revenue_today', 15000);
  });

  it('should return 401 Unauthorized if the user is unauthenticated', async () => {
    const response = await request(makeApp())
      .get('/admin/dashboard')
      .set('x-mock-unauthenticated', 'true');

    expect(response.status).toBe(401);
  });

  it('should return 403 Forbidden if the user is not an admin', async () => {
    const response = await request(makeApp())
      .get('/admin/dashboard')
      .set('x-mock-role', 'driver');

    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty('error');
  });

  it('should handle Supabase query errors gracefully with a 500 status', async () => {
    adminDb.from.mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ count: null, error: { message: 'Database connection failed' } })),
        })),
      })),
    }));

    const response = await request(makeApp())
      .get('/admin/dashboard')
      .set('x-mock-role', 'admin');

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('error');
  });
});
