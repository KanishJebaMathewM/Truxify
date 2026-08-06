import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { hashOtp } from '../../src/lib/otpHashing.js';

const mockSupabaseQuery = vi.fn();
const mockSupabaseUpdate = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: (table) => ({
      select: vi.fn().mockReturnThis(),
      update: (data) => {
        return {
          eq: vi.fn().mockReturnValue(mockSupabaseUpdate(table, data))
        };
      },
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: () => mockSupabaseQuery(table),
    }),
  },
  redisClient: null,
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (req, res, next) => next(),
  otpVerificationLimiter: (req, res, next) => next(),
}));

const { default: authRouter } = await import('../../src/routes/authRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

describe('POST /api/auth/verify-otp', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('successfully verifies a new scrypt salted OTP', async () => {
    const otp = '123456';
    const { hash, salt } = hashOtp(otp);

    mockSupabaseQuery.mockResolvedValueOnce({
      data: { id: 1, otp_hash: hash, otp_salt: salt, expires_at: '2099-01-01T00:00:00Z', verified: false },
      error: null
    });
    mockSupabaseUpdate.mockResolvedValueOnce({ error: null });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('OTP verified successfully.');
    expect(mockSupabaseUpdate).toHaveBeenCalled();
  });

  it('successfully verifies a legacy SHA-256 unsalted OTP (fallback)', async () => {
    const otp = '654321';
    const legacyHash = crypto.createHash('sha256').update(String(otp)).digest('hex');

    mockSupabaseQuery.mockResolvedValueOnce({
      data: { id: 2, otp_hash: legacyHash, otp_salt: null, expires_at: '2099-01-01T00:00:00Z', verified: false },
      error: null
    });
    mockSupabaseUpdate.mockResolvedValueOnce({ error: null });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('OTP verified successfully.');
  });

  it('returns 400 for incorrect OTP (scrypt)', async () => {
    const otp = '123456';
    const { hash, salt } = hashOtp(otp);

    mockSupabaseQuery.mockResolvedValueOnce({
      data: { id: 1, otp_hash: hash, otp_salt: salt, expires_at: '2099-01-01T00:00:00Z', verified: false },
      error: null
    });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp: '111111' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid OTP.');
  });

  it('returns 400 for incorrect OTP (legacy fallback)', async () => {
    const otp = '654321';
    const legacyHash = crypto.createHash('sha256').update(String(otp)).digest('hex');

    mockSupabaseQuery.mockResolvedValueOnce({
      data: { id: 2, otp_hash: legacyHash, otp_salt: null, expires_at: '2099-01-01T00:00:00Z', verified: false },
      error: null
    });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp: '111111' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid OTP.');
  });
});
