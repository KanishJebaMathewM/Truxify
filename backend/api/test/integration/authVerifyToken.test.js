import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'truxify-jwt-secret-key';

// Mock DB module
vi.mock('../../src/config/db.js', () => {
  return {
    supabase: null,
    supabaseAdmin: null,
    firebaseAdmin: null,
    createUserClient: () => null,
    redisClient: null,
  };
});

import authRoutes from '../../src/routes/authRoutes.js';
import { authenticate } from '../../src/middleware/auth.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

app.get('/api/protected', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

describe('User Authentication — Firebase ID Token & Backend JWT Exchange', () => {
  it('should return 400 when verify is called without idToken or email', async () => {
    const res = await request(app)
      .post('/api/auth/verify')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('idToken or email is required');
  });

  it('should exchange idToken/email for a signed backend JWT token', async () => {
    const res = await request(app)
      .post('/api/auth/verify')
      .send({
        email: 'driver.auth@truxify.com',
        role: 'driver',
        uid: 'firebase-uid-999',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('driver.auth@truxify.com');
    expect(res.body.user.role).toBe('driver');

    // Verify JWT payload
    const decoded = jwt.verify(res.body.token, JWT_SECRET);
    expect(decoded.email).toBe('driver.auth@truxify.com');
    expect(decoded.role).toBe('driver');
  });

  it('should reject unauthenticated request to protected route with 401', async () => {
    const res = await request(app).get('/api/protected');
    expect(res.status).toBe(401);
  });

  it('should accept valid backend JWT in Authorization Bearer header on protected routes', async () => {
    // Generate valid backend token
    const testToken = jwt.sign(
      {
        id: 'usr-jwt-123',
        uid: 'firebase-uid-123',
        email: 'customer@truxify.com',
        role: 'customer',
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${testToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.id).toBe('usr-jwt-123');
    expect(res.body.user.email).toBe('customer@truxify.com');
  });
});
