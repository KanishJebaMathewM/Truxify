import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

let mockUser = { id: 'usr-driver-88', role: 'driver' };

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const biometricAuthServiceMock = vi.hoisted(() => ({
  requiresBiometricAuth: vi.fn(),
  getBiometricThreshold: vi.fn(),
  updateBiometricThreshold: vi.fn(),
  createChallenge: vi.fn(),
  verifyBiometric: vi.fn(),
  verifyFallbackOtp: vi.fn(),
  getChallengeStatus: vi.fn(),
}));

vi.mock('../../src/services/biometricAuthService.js', () => biometricAuthServiceMock);

const {
  default: biometricAuthRouter,
  isValidBiometricMethod,
  isValidOtpFormat,
  isValidBiometricToken,
  isValidChallengeId,
  isValidShipmentId,
} = await import('../../src/routes/biometricAuthRoutes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/biometric-auth', biometricAuthRouter);
  return app;
}

describe('biometricAuthRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'usr-driver-88', role: 'driver' };
  });

  describe('Validation Helpers', () => {
    it('validates allowed biometric methods correctly', () => {
      expect(isValidBiometricMethod('fingerprint')).toBe(true);
      expect(isValidBiometricMethod('FINGERPRINT')).toBe(true);
      expect(isValidBiometricMethod('face_recognition')).toBe(true);
      expect(isValidBiometricMethod('iris')).toBe(false);
      expect(isValidBiometricMethod('voice')).toBe(false);
      expect(isValidBiometricMethod(null)).toBe(false);
    });

    it('validates 6-digit OTP formatting correctly', () => {
      expect(isValidOtpFormat('123456')).toBe(true);
      expect(isValidOtpFormat(654321)).toBe(true);
      expect(isValidOtpFormat('000123')).toBe(true);
      expect(isValidOtpFormat('12345')).toBe(false);
      expect(isValidOtpFormat('1234567')).toBe(false);
      expect(isValidOtpFormat('abcdef')).toBe(false);
      expect(isValidOtpFormat(null)).toBe(false);
    });

    it('validates base64url biometric tokens correctly', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9_abc-123';
      expect(isValidBiometricToken(validToken)).toBe(true);
      expect(isValidBiometricToken('short')).toBe(false);
      expect(isValidBiometricToken('invalid+base64/with/slashes')).toBe(false);
      expect(isValidBiometricToken(null)).toBe(false);
    });

    it('validates 32-character hex challenge IDs', () => {
      expect(isValidChallengeId('a1b2c3d4e5f60718293a4b5c6d7e8f90')).toBe(true);
      expect(isValidChallengeId('A1B2C3D4E5F60718293A4B5C6D7E8F90')).toBe(true);
      expect(isValidChallengeId('short-id')).toBe(false);
      expect(isValidChallengeId('g1b2c3d4e5f60718293a4b5c6d7e8f90')).toBe(false);
      expect(isValidChallengeId(null)).toBe(false);
    });

    it('validates shipment IDs', () => {
      expect(isValidShipmentId('SHP-99201')).toBe(true);
      expect(isValidShipmentId('order_123:alpha')).toBe(true);
      expect(isValidShipmentId('')).toBe(false);
      expect(isValidShipmentId('bad space')).toBe(false);
      expect(isValidShipmentId('x'.repeat(65))).toBe(false);
    });
  });

  describe('POST /api/biometric-auth/check', () => {
    it('returns whether biometric auth is required', async () => {
      biometricAuthServiceMock.requiresBiometricAuth.mockReturnValue(true);
      biometricAuthServiceMock.getBiometricThreshold.mockReturnValue({ threshold_paisa: 5000000 });

      const res = await request(makeApp())
        .post('/api/biometric-auth/check')
        .send({ freight_value_paisa: 6000000 });

      expect(res.status).toBe(200);
      expect(res.body.biometric_required).toBe(true);
      expect(res.body.threshold_paisa).toBe(5000000);
      expect(biometricAuthServiceMock.requiresBiometricAuth).toHaveBeenCalledWith('usr-driver-88', 6000000);
    });

    it('rejects invalid freight value with 400', async () => {
      const res = await request(makeApp())
        .post('/api/biometric-auth/check')
        .send({ freight_value_paisa: -100 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-negative integer/i);
    });

    it('rejects values exceeding maximum limit with 400', async () => {
      const res = await request(makeApp())
        .post('/api/biometric-auth/check')
        .send({ freight_value_paisa: 200_000_000_00 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/exceeds maximum allowed limit/i);
    });
  });

  describe('POST /api/biometric-auth/challenge', () => {
    const validPayload = {
      shipment_id: 'SHP-1002',
      freight_value_paisa: 8000000,
    };

    it('creates a challenge when freight value exceeds threshold', async () => {
      biometricAuthServiceMock.requiresBiometricAuth.mockReturnValue(true);
      biometricAuthServiceMock.createChallenge.mockReturnValue({
        challenge_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        nonce: 'fedcba9876543210',
        expires_at: Date.now() + 300000,
      });

      const res = await request(makeApp())
        .post('/api/biometric-auth/challenge')
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/challenge created/i);
      expect(res.body.challenge_id).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
      expect(biometricAuthServiceMock.createChallenge).toHaveBeenCalledWith('usr-driver-88', 'SHP-1002', 8000000);
    });

    it('rejects with 403 if freight value does not require biometric auth', async () => {
      biometricAuthServiceMock.requiresBiometricAuth.mockReturnValue(false);
      biometricAuthServiceMock.getBiometricThreshold.mockReturnValue({ threshold_paisa: 5000000 });

      const res = await request(makeApp())
        .post('/api/biometric-auth/challenge')
        .send(validPayload);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not required/i);
    });

    it('rejects invalid shipment ID with 400', async () => {
      const res = await request(makeApp())
        .post('/api/biometric-auth/challenge')
        .send({ shipment_id: '', freight_value_paisa: 8000000 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/shipment_id must be a valid/i);
    });

    it('handles unexpected challenge creation failure with 500', async () => {
      biometricAuthServiceMock.requiresBiometricAuth.mockReturnValue(true);
      biometricAuthServiceMock.createChallenge.mockImplementation(() => {
        throw new Error('Entropy exhaustion');
      });

      const res = await request(makeApp())
        .post('/api/biometric-auth/challenge')
        .send(validPayload);

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Failed to create/i);
    });
  });

  describe('POST /api/biometric-auth/verify', () => {
    const validVerifyPayload = {
      challenge_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      biometric_token: 'valid_base64url_token_proof_data_1234567890',
      method: 'fingerprint',
    };

    it('successfully verifies proof token', async () => {
      biometricAuthServiceMock.verifyBiometric.mockReturnValue({
        success: true,
        authenticated_at: Date.now(),
      });

      const res = await request(makeApp())
        .post('/api/biometric-auth/verify')
        .send(validVerifyPayload);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/successful/i);
      expect(biometricAuthServiceMock.verifyBiometric).toHaveBeenCalledWith(
        validVerifyPayload.challenge_id,
        validVerifyPayload.biometric_token,
        'fingerprint',
        'usr-driver-88'
      );
    });

    it('rejects invalid challenge_id format with 400', async () => {
      const res = await request(makeApp())
        .post('/api/biometric-auth/verify')
        .send({
          ...validVerifyPayload,
          challenge_id: 'bad-challenge-id',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/32-character hexadecimal/i);
    });

    it('rejects invalid biometric token with 400', async () => {
      const res = await request(makeApp())
        .post('/api/biometric-auth/verify')
        .send({
          ...validVerifyPayload,
          biometric_token: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Base64URL-encoded/i);
    });

    it('rejects disallowed biometric method with 400', async () => {
      const res = await request(makeApp())
        .post('/api/biometric-auth/verify')
        .send({
          ...validVerifyPayload,
          method: 'voice_pattern',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid method/i);
    });

    it('returns 400 on verification failure from service', async () => {
      biometricAuthServiceMock.verifyBiometric.mockReturnValue({
        success: false,
        error: 'HMAC signature verification failed',
      });

      const res = await request(makeApp())
        .post('/api/biometric-auth/verify')
        .send(validVerifyPayload);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('HMAC signature verification failed');
    });
  });

  describe('POST /api/biometric-auth/fallback', () => {
    const validFallbackPayload = {
      challenge_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      otp: '789123',
    };

    it('successfully processes fallback OTP', async () => {
      biometricAuthServiceMock.verifyFallbackOtp.mockReturnValue({
        success: true,
        verified_via: 'sms_otp',
      });

      const res = await request(makeApp())
        .post('/api/biometric-auth/fallback')
        .send(validFallbackPayload);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Fallback OTP authentication successful/i);
    });

    it('rejects invalid OTP format with 400', async () => {
      const res = await request(makeApp())
        .post('/api/biometric-auth/fallback')
        .send({
          ...validFallbackPayload,
          otp: '1234',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/6-digit numeric/i);
    });

    it('returns 400 if service returns error on expired challenge', async () => {
      biometricAuthServiceMock.verifyFallbackOtp.mockReturnValue({
        success: false,
        error: 'Challenge session has expired',
      });

      const res = await request(makeApp())
        .post('/api/biometric-auth/fallback')
        .send(validFallbackPayload);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/expired/i);
    });
  });

  describe('GET /api/biometric-auth/status/:challengeId', () => {
    it('returns status for valid challenge', async () => {
      const mockStatus = {
        challenge_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        status: 'PENDING',
      };
      biometricAuthServiceMock.getChallengeStatus.mockReturnValue(mockStatus);

      const res = await request(makeApp())
        .get('/api/biometric-auth/status/a1b2c3d4e5f60718293a4b5c6d7e8f90');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockStatus);
    });

    it('rejects malformed challengeId in route param with 400', async () => {
      const res = await request(makeApp())
        .get('/api/biometric-auth/status/non-hex-id');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/32-character hexadecimal/i);
    });

    it('returns 404 if challenge is not found', async () => {
      biometricAuthServiceMock.getChallengeStatus.mockReturnValue(null);

      const res = await request(makeApp())
        .get('/api/biometric-auth/status/a1b2c3d4e5f60718293a4b5c6d7e8f90');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('GET & PUT /api/biometric-auth/threshold', () => {
    it('returns user threshold on GET', async () => {
      biometricAuthServiceMock.getBiometricThreshold.mockReturnValue({ threshold_paisa: 7500000 });

      const res = await request(makeApp()).get('/api/biometric-auth/threshold');

      expect(res.status).toBe(200);
      expect(res.body.threshold_paisa).toBe(7500000);
    });

    it('updates user threshold on PUT for valid positive integer', async () => {
      biometricAuthServiceMock.updateBiometricThreshold.mockReturnValue({ threshold_paisa: 3000000 });

      const res = await request(makeApp())
        .put('/api/biometric-auth/threshold')
        .send({ threshold_paisa: 3000000 });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/threshold updated/i);
      expect(res.body.threshold_paisa).toBe(3000000);
    });

    it('rejects negative or non-numeric threshold with 400', async () => {
      const res = await request(makeApp())
        .put('/api/biometric-auth/threshold')
        .send({ threshold_paisa: -100 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/positive integer/i);
    });
  });
});
