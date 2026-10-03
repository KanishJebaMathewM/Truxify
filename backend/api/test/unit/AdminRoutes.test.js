const request = require('supertest');
const express = require('express');

// Create mock middleware and database client before importing routes
jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (req.headers['x-mock-unauthenticated'] === 'true') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { id: 'admin-user-id', role: req.headers['x-mock-role'] || 'admin' };
    next();
  },
  requirePolicy: (policyName) => (req, res, next) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    next();
  }
}));

const mockSupabaseFrom = jest.fn();
jest.mock('../../src/config/db', () => ({
  supabaseAdmin: {
    from: (...args) => mockSupabaseFrom(...args)
  }
}));

const adminRouter = require('../../src/routes/adminRoutes');

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

describe('Admin Routes - GET /dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully retrieve dashboard stats for an admin user', async () => {
    // Mock successful Supabase queries for stats
    mockSupabaseFrom.mockImplementation((table) => {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        count: jest.fn().mockResolvedValue({ count: table === 'drivers' ? 12 : 5, error: null }),
        then: (resolve) => resolve({ data: [{ total_revenue: 15000 }], error: null })
      };
    });

    const response = await request(app)
      .get('/admin/dashboard')
      .set('x-mock-role', 'admin');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('active_drivers');
    expect(response.body).toHaveProperty('pending_orders');
    expect(response.body).toHaveProperty('revenue');
  });

  it('should return 401 Unauthorized if the user is unauthenticated', async () => {
    const response = await request(app)
      .get('/admin/dashboard')
      .set('x-mock-unauthenticated', 'true');

    expect(response.status).toBe(401);
  });

  it('should return 403 Forbidden if the user is not an admin', async () => {
    const response = await request(app)
      .get('/admin/dashboard')
      .set('x-mock-role', 'driver'); // Non-admin role

    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty('error');
  });

  it('should handle Supabase query errors gracefully with a 500 status', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      count: jest.fn().mockResolvedValue({ count: null, error: { message: 'Database connection failed' } })
    });

    const response = await request(app)
      .get('/admin/dashboard')
      .set('x-mock-role', 'admin');

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('error');
  });
});
