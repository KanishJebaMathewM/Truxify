import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

// Mock database config
let mockGetUser = vi.fn();
let mockProfileQuery = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    auth: {
      getUser: (...args) => mockGetUser(...args)
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => mockProfileQuery()
          })
        })
      })
    })
  },
  createUserClient: (token) => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => mockProfileQuery()
          })
        })
      })
    })
  }),
  firebaseAdmin: null
}));

const { verifyJWT } = await import('../../src/middleware/auth.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  
  // Apply globally on /api
  app.use('/api', verifyJWT);

  // Mock public endpoints
  app.post('/api/auth/login', (req, res) => res.json({ success: true, message: 'login' }));
  app.post('/api/auth/register', (req, res) => res.json({ success: true, message: 'register' }));
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // Mock protected endpoints
  app.get('/api/driver/availability', (req, res) => res.json({ status: 'driver-ok' }));
  app.get('/api/orders', (req, res) => res.json({ status: 'customer-ok' }));

  return app;
}

describe('verifyJWT Global Middleware', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    mockGetUser.mockReset();
    mockProfileQuery.mockReset();
    process.env.BYPASS_AUTH = 'false';
  });

  describe('Public Route Exclusions', () => {
    it('allows GET /api/health without token', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('allows POST /api/auth/login without token', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('login');
    });

    it('allows POST /api/auth/register without token', async () => {
      const res = await request(app).post('/api/auth/register').send({});
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('register');
    });
  });

  describe('Authentication Enforcement', () => {
    it('rejects GET /api/orders if no Authorization header is present', async () => {
      const res = await request(app).get('/api/orders');
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Access Denied');
    });

    it('rejects GET /api/orders if token is invalid or expired', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Expired' } });
      const token = jwt.sign({ iss: 'https://xyz.supabase.co' }, 'secret');

      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid or expired');
    });
  });

  describe('Role-Based Access Control', () => {
    it('allows driver role to access driver endpoints', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'driver-id-123' } }, error: null });
      mockProfileQuery.mockResolvedValue({
        data: { id: 'driver-id-123', role: 'driver', is_active: true, full_name: 'Driver Joe' },
        error: null
      });
      const token = jwt.sign({ iss: 'https://xyz.supabase.co' }, 'secret');

      const res = await request(app)
        .get('/api/driver/availability')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('driver-ok');
    });

    it('denies customer role from accessing driver endpoints', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'customer-id-123' } }, error: null });
      mockProfileQuery.mockResolvedValue({
        data: { id: 'customer-id-123', role: 'customer', is_active: true, full_name: 'Customer Bob' },
        error: null
      });
      const token = jwt.sign({ iss: 'https://xyz.supabase.co' }, 'secret');

      const res = await request(app)
        .get('/api/driver/availability')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Drivers only');
    });

    it('allows customer role to access customer endpoints', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'customer-id-123' } }, error: null });
      mockProfileQuery.mockResolvedValue({
        data: { id: 'customer-id-123', role: 'customer', is_active: true, full_name: 'Customer Bob' },
        error: null
      });
      const token = jwt.sign({ iss: 'https://xyz.supabase.co' }, 'secret');

      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('customer-ok');
    });

    it('denies driver role from accessing customer endpoints', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'driver-id-123' } }, error: null });
      mockProfileQuery.mockResolvedValue({
        data: { id: 'driver-id-123', role: 'driver', is_active: true, full_name: 'Driver Joe' },
        error: null
      });
      const token = jwt.sign({ iss: 'https://xyz.supabase.co' }, 'secret');

      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Customers only');
    });
  });
});
