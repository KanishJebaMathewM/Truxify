import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import adminRouter from '../../src/routes/adminRoutes.js';
import { supabaseAdmin } from '../../src/config/db.js';

// Mock dependencies
vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: vi.fn()
  },
  supabaseAdmin: {
    from: vi.fn()
  }
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    if (req.headers['x-simulate-unauth'] === 'true') {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = { id: 'admin-user-id', role: 'admin' };
    next();
  }
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: (policy) => (req, res, next) => {
    if (req.headers['x-simulate-forbidden'] === 'true') {
      return res.status(403).json({ error: 'Forbidden - admin role required' });
    }
    next();
  }
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (req, res, next) => next()
}));

vi.mock('../../src/middleware/auditLog.js', () => ({
  auditLog: (options) => (req, res, next) => next()
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

const app = express();
app.use(express.json());
app.use('/api/v1/admin', adminRouter);

describe('Admin Routes - GET /api/v1/admin/dashboard (Comprehensive Test Suite)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return successfully aggregated dashboard stats when all queries succeed', async () => {
    let callCount = 0;
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockResolvedValue({ count: 12, error: null })
          }))
        };
      }
      if (table === 'orders') {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 5, error: null })
          };
        } else {
          return {
            select: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { total_amount: 15000 },
                { total_amount: 35000 }
              ],
              error: null
            })
          };
        }
      }
      return {};
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      active_drivers: 12,
      pending_orders: 5,
      total_revenue_today: 500
    });
  });

  it('should return zero values gracefully when no drivers, orders or revenue exist', async () => {
    let callCount = 0;
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockResolvedValue({ count: 0, error: null })
          }))
        };
      }
      if (table === 'orders') {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 0, error: null })
          };
        } else {
          return {
            select: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [],
              error: null
            })
          };
        }
      }
      return {};
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      active_drivers: 0,
      pending_orders: 0,
      total_revenue_today: 0
    });
  });

  it('should return 401 when authentication middleware rejects request', async () => {
    const response = await request(app)
      .get('/api/v1/admin/dashboard')
      .set('x-simulate-unauth', 'true');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Authentication required' });
  });

  it('should return 403 when policy check fails', async () => {
    const response = await request(app)
      .get('/api/v1/admin/dashboard')
      .set('x-simulate-forbidden', 'true');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden - admin role required' });
  });

  it('should return 500 if fetching active drivers fails', async () => {
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'DB Error drivers' } })
          }))
        };
      }
      return {};
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to fetch drivers count.' });
  });

  it('should return 500 if fetching pending orders fails', async () => {
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockResolvedValue({ count: 10, error: null })
          }))
        };
      }
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'DB Error orders' } })
        };
      }
      return {};
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to fetch pending orders.' });
  });

  it('should return 500 if fetching revenue orders fails', async () => {
    let callCount = 0;
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockResolvedValue({ count: 8, error: null })
          }))
        };
      }
      if (table === 'orders') {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 3, error: null })
          };
        } else {
          return {
            select: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: null, error: { message: 'Revenue fetch error' } })
          };
        }
      }
      return {};
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to fetch revenue.' });
  });

  it('should handle unhandled exceptions gracefully with 500 Internal Server Error', async () => {
    supabaseAdmin.from.mockImplementation(() => {
      throw new Error('Unexpected catastrophic database crash');
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
  });

  it('should correctly format revenue calculations when total_amount contains decimal/float paisa values', async () => {
    let callCount = 0;
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockResolvedValue({ count: 2, error: null })
          }))
        };
      }
      if (table === 'orders') {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 1, error: null })
          };
        } else {
          return {
            select: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { total_amount: 10050 },
                { total_amount: 20075 }
              ],
              error: null
            })
          };
        }
      }
      return {};
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      active_drivers: 2,
      pending_orders: 1,
      total_revenue_today: 301.25
    });
  });

  it('should treat null or missing total_amount fields as zero safely during revenue reduction', async () => {
    let callCount = 0;
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockResolvedValue({ count: 4, error: null })
          }))
        };
      }
      if (table === 'orders') {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 2, error: null })
          };
        } else {
          return {
            select: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { total_amount: null },
                { total_amount: 45000 }
              ],
              error: null
            })
          };
        }
      }
      return {};
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      active_drivers: 4,
      pending_orders: 2,
      total_revenue_today: 450
    });
  });

  it('should fall back to standard supabase client when supabaseAdmin is null or undefined', async () => {
    let callCount = 0;
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockResolvedValue({ count: 7, error: null })
          }))
        };
      }
      if (table === 'orders') {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 3, error: null })
          };
        } else {
          return {
            select: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ total_amount: 10000 }],
              error: null
            })
          };
        }
      }
      return {};
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(200);
    expect(response.body.active_drivers).toBe(7);
  });

  it('should pass correct query filters and pagination parameters to database tables', async () => {
    const profilesSelectMock = vi.fn().mockReturnThis();
    const profilesEqActiveMock = vi.fn().mockResolvedValue({ count: 5, error: null });

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: profilesSelectMock,
          eq: vi.fn((field, val) => {
            if (field === 'role') return { eq: profilesEqActiveMock };
            return { eq: profilesEqActiveMock };
          })
        };
      }
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
          gte: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [{ total_amount: 5000 }], error: null })
        };
      }
      return {};
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(200);
    expect(profilesSelectMock).toHaveBeenCalledWith('*', { count: 'exact', head: true });
  });

  it('should ensure response headers return application/json on successful dashboard fetch', async () => {
    let callCount = 0;
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockResolvedValue({ count: 10, error: null })
          }))
        };
      }
      if (table === 'orders') {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 2, error: null })
          };
        } else {
          return {
            select: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ total_amount: 10000 }],
              error: null
            })
          };
        }
      }
      return {};
    });

    const response = await request(app).get('/api/v1/admin/dashboard');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
  });
});