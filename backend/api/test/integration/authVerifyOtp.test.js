import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { hashOtp } from '../../src/lib/otpHashing.js';

const { mockAdminSelect, mockAdminUpdate, mockAnonFrom } = vi.hoisted(() => ({
  mockAdminSelect: vi.fn(),
  mockAdminUpdate: vi.fn(),
  mockAnonFrom: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => {
  const adminFrom = vi.fn((table) => {
    let isUpdate = false;
    const chain = {
      select: vi.fn(() => chain),
      update: vi.fn(() => {
        isUpdate = true;
        return chain;
      }),
      eq: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(() =>
        isUpdate ? mockAdminUpdate(table) : mockAdminSelect(table),
      ),
    };
    return chain;
  });

  return {
    supabase: { from: mockAnonFrom },
    supabaseAdmin: { from: adminFrom },
    firebaseAdmin: null,
    redisClient: null,
  };
});

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
  otpVerificationLimiter: (_req, _res, next) => next(),
  createStore: () => undefined,
}));

vi.mock('../../src/controllers/authController.js', () => ({
  refreshToken: (_req, _res, next) => next(),
}));

vi.mock('../../src/services/order/orderNotificationService.js', () => ({
  OTP_MAX_FAILED_ATTEMPTS: 5,
  OTP_LOCKOUT_MINUTES: 30,
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
    mockAdminSelect.mockReset();
    mockAdminUpdate.mockReset();
    mockAnonFrom.mockReset();
  });

  it('reads and consumes the OTP through the service-role client', async () => {
    const otp = '123456';
    const { hash, salt } = hashOtp(otp);

    mockAdminSelect.mockResolvedValueOnce({
      data: {
        id: 1,
        otp_hash: hash,
        otp_salt: salt,
        expires_at: '2099-01-01T00:00:00Z',
        verified: false,
        is_active: true,
      },
      error: null,
    });
    mockAdminUpdate.mockResolvedValueOnce({ data: { id: 1 }, error: null });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('OTP verified successfully.');
    expect(mockAdminSelect).toHaveBeenCalledWith('phone_otps');
    expect(mockAdminUpdate).toHaveBeenCalledWith('phone_otps');
    expect(mockAnonFrom).not.toHaveBeenCalled();
  });

  it('returns 409 when a concurrent request already consumed the row', async () => {
    const otp = '123456';
    const { hash, salt } = hashOtp(otp);

    mockAdminSelect.mockResolvedValueOnce({
      data: {
        id: 1,
        otp_hash: hash,
        otp_salt: salt,
        expires_at: '2099-01-01T00:00:00Z',
        verified: false,
        is_active: true,
      },
      error: null,
    });
    mockAdminUpdate.mockResolvedValueOnce({ data: null, error: null });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/already been used/i);
    expect(mockAnonFrom).not.toHaveBeenCalled();
  });

  it('returns 500 when the service-role lookup fails', async () => {
    mockAdminSelect.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table phone_otps' },
    });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp: '123456' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(mockAdminUpdate).not.toHaveBeenCalled();
    expect(mockAnonFrom).not.toHaveBeenCalled();
  });

  it('successfully verifies a legacy SHA-256 unsalted OTP (fallback)', async () => {
    const otp = '654321';
    const legacyHash = crypto.createHash('sha256').update(String(otp)).digest('hex');

    mockAdminSelect.mockResolvedValueOnce({
      data: {
        id: 2,
        otp_hash: legacyHash,
        otp_salt: null,
        expires_at: '2099-01-01T00:00:00Z',
        verified: false,
        is_active: true,
      },
      error: null,
    });
    mockAdminUpdate.mockResolvedValueOnce({ data: { id: 2 }, error: null });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('OTP verified successfully.');
  });

  it('returns 400 for an incorrect OTP (scrypt)', async () => {
    const otp = '123456';
    const { hash, salt } = hashOtp(otp);

    mockAdminSelect.mockResolvedValueOnce({
      data: {
        id: 1,
        otp_hash: hash,
        otp_salt: salt,
        expires_at: '2099-01-01T00:00:00Z',
        verified: false,
        is_active: true,
      },
      error: null,
    });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp: '111111' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/^Invalid OTP\. \d+ attempt\(s\) remaining before lockout\.$/);
    expect(mockAdminUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 for an incorrect OTP (legacy fallback)', async () => {
    const otp = '654321';
    const legacyHash = crypto.createHash('sha256').update(String(otp)).digest('hex');

    mockAdminSelect.mockResolvedValueOnce({
      data: {
        id: 2,
        otp_hash: legacyHash,
        otp_salt: null,
        expires_at: '2099-01-01T00:00:00Z',
        verified: false,
        is_active: true,
      },
      error: null,
    });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp: '111111' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/^Invalid OTP\. \d+ attempt\(s\) remaining before lockout\.$/);
    expect(mockAdminUpdate).not.toHaveBeenCalled();
  });
});
