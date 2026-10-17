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

let mockUser = { id: 'user-carrier-1', role: 'carrier' };

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const carbonTokenServiceMock = vi.hoisted(() => ({
  calculateAndMintCarbonCredits: vi.fn(),
  purchaseCarbonCredits: vi.fn(),
  getTokenDetails: vi.fn(),
}));

vi.mock('../../src/services/carbonTokenService.js', () => ({
  carbonTokenService: carbonTokenServiceMock,
}));

const {
  default: carbonTokenRouter,
  isValidEvmAddress,
  isValidTokenId,
  isValidIdentifier,
} = await import('../../src/routes/carbonTokenRoutes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/carbon-credits', carbonTokenRouter);
  return app;
}

describe('carbonTokenRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'user-carrier-1', role: 'carrier' };
  });

  describe('Validation Helpers', () => {
    it('validates EVM wallet address correctly', () => {
      expect(isValidEvmAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
      expect(isValidEvmAddress('0xABCDEF0123456789ABCDEF0123456789ABCDEF01')).toBe(true);
      expect(isValidEvmAddress('0x123')).toBe(false);
      expect(isValidEvmAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false);
      expect(isValidEvmAddress(null)).toBe(false);
    });

    it('validates token ID structure correctly', () => {
      expect(isValidTokenId('CCT-TRIP-900-1700000000')).toBe(true);
      expect(isValidTokenId('CCT-TRK-ALPHA-99')).toBe(true);
      expect(isValidTokenId('')).toBe(false);
      expect(isValidTokenId(null)).toBe(false);
    });

    it('validates general entity identifiers', () => {
      expect(isValidIdentifier('TRUCK-101')).toBe(true);
      expect(isValidIdentifier('trip_2026_09')).toBe(true);
      expect(isValidIdentifier('invalid spaced id')).toBe(false);
      expect(isValidIdentifier('x'.repeat(65))).toBe(false);
    });
  });

  describe('POST /api/carbon-credits/mint', () => {
    const validMintPayload = {
      truck_id: 'TRUCK-VOLVO-404',
      trip_id: 'TRIP-DELHI-MUMBAI-88',
      distance_km: 1420,
      fuel_saved_liters: 75.5,
      load_weight_kg: 24000,
    };

    it('successfully mints carbon tokens when called by carrier', async () => {
      const mockToken = {
        tokenId: 'CCT-TRIP-DELHI-MUMBAI-88-171000',
        truckId: validMintPayload.truck_id,
        tripId: validMintPayload.trip_id,
        co2SavedKg: 202.34,
        co2SavedMetricTons: 0.202,
        status: 'PENDING_CHAIN_ANCHOR',
      };
      carbonTokenServiceMock.calculateAndMintCarbonCredits.mockResolvedValue(mockToken);

      const res = await request(makeApp())
        .post('/api/carbon-credits/mint')
        .send(validMintPayload);

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/minted successfully/i);
      expect(res.body.token).toEqual(mockToken);
      expect(carbonTokenServiceMock.calculateAndMintCarbonCredits).toHaveBeenCalledWith({
        ownerId: 'user-carrier-1',
        truckId: validMintPayload.truck_id,
        tripId: validMintPayload.trip_id,
        distanceKm: 1420,
        fuelSavedLiters: 75.5,
        loadWeightKg: 24000,
      });
    });

    it('allows driver role to mint carbon tokens', async () => {
      mockUser = { id: 'usr-driver-2', role: 'driver' };
      carbonTokenServiceMock.calculateAndMintCarbonCredits.mockResolvedValue({ tokenId: 'CCT-1' });

      const res = await request(makeApp())
        .post('/api/carbon-credits/mint')
        .send(validMintPayload);

      expect(res.status).toBe(201);
    });

    it('denies unauthorized roles (e.g. shipper) from minting credits with 403', async () => {
      mockUser = { id: 'usr-shipper-9', role: 'shipper' };

      const res = await request(makeApp())
        .post('/api/carbon-credits/mint')
        .send(validMintPayload);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
      expect(carbonTokenServiceMock.calculateAndMintCarbonCredits).not.toHaveBeenCalled();
    });

    it('rejects missing required parameters with 400', async () => {
      const res = await request(makeApp())
        .post('/api/carbon-credits/mint')
        .send({ truck_id: 'TRUCK-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required parameters/i);
    });

    it('rejects invalid identifier format for truck_id with 400', async () => {
      const res = await request(makeApp())
        .post('/api/carbon-credits/mint')
        .send({
          ...validMintPayload,
          truck_id: 'bad truck id with spaces',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/alphanumeric identifiers/i);
    });

    it('rejects zero or negative fuel_saved_liters with 400', async () => {
      const res = await request(makeApp())
        .post('/api/carbon-credits/mint')
        .send({
          ...validMintPayload,
          fuel_saved_liters: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/greater than zero/i);
    });

    it('rejects excessive distance_km above limit with 400', async () => {
      const res = await request(makeApp())
        .post('/api/carbon-credits/mint')
        .send({
          ...validMintPayload,
          distance_km: 60000,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/exceeds maximum threshold/i);
    });

    it('rejects excessive fuel_saved_liters above limit with 400', async () => {
      const res = await request(makeApp())
        .post('/api/carbon-credits/mint')
        .send({
          ...validMintPayload,
          fuel_saved_liters: 15000,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/exceeds maximum single-trip threshold/i);
    });

    it('handles unexpected service error with 500', async () => {
      carbonTokenServiceMock.calculateAndMintCarbonCredits.mockRejectedValue(
        new Error('Chain RPC failure')
      );

      const res = await request(makeApp())
        .post('/api/carbon-credits/mint')
        .send(validMintPayload);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Chain RPC failure');
    });
  });

  describe('POST /api/carbon-credits/purchase', () => {
    const validPurchasePayload = {
      token_id: 'CCT-TRIP-DELHI-MUMBAI-88-171000',
      buyer_address: '0x1234567890abcdef1234567890abcdef12345678',
    };

    beforeEach(() => {
      mockUser = { id: 'usr-shipper-42', role: 'shipper' };
    });

    it('allows shipper to purchase and retire carbon credits', async () => {
      const mockRetired = {
        tokenId: validPurchasePayload.token_id,
        buyerAddress: validPurchasePayload.buyer_address,
        status: 'RETIRED_SCOPE_3_OFFSET',
      };
      carbonTokenServiceMock.purchaseCarbonCredits.mockResolvedValue(mockRetired);

      const res = await request(makeApp())
        .post('/api/carbon-credits/purchase')
        .send(validPurchasePayload);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Scope 3 emissions offset/i);
      expect(res.body.token).toEqual(mockRetired);
      expect(carbonTokenServiceMock.purchaseCarbonCredits).toHaveBeenCalledWith({
        tokenId: validPurchasePayload.token_id,
        buyerAddress: validPurchasePayload.buyer_address,
        shipperId: 'usr-shipper-42',
        ownerId: 'usr-shipper-42',
      });
    });

    it('denies driver or carrier role from purchasing credits with 403', async () => {
      mockUser = { id: 'usr-carrier-1', role: 'carrier' };

      const res = await request(makeApp())
        .post('/api/carbon-credits/purchase')
        .send(validPurchasePayload);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
    });

    it('rejects missing parameters with 400', async () => {
      const res = await request(makeApp())
        .post('/api/carbon-credits/purchase')
        .send({ token_id: 'CCT-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required parameters/i);
    });

    it('rejects invalid EVM buyer address format with 400', async () => {
      const res = await request(makeApp())
        .post('/api/carbon-credits/purchase')
        .send({
          ...validPurchasePayload,
          buyer_address: 'invalid-wallet',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valid 40-character hex EVM wallet/i);
    });

    it('returns 404 when token is not found during purchase', async () => {
      carbonTokenServiceMock.purchaseCarbonCredits.mockRejectedValue(
        new Error('Token not found: CCT-NONEXISTENT')
      );

      const res = await request(makeApp())
        .post('/api/carbon-credits/purchase')
        .send(validPurchasePayload);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('GET /api/carbon-credits/:tokenId', () => {
    it('returns token details when found', async () => {
      const mockToken = {
        tokenId: 'CCT-TRIP-900-1700000000',
        status: 'PENDING_CHAIN_ANCHOR',
      };
      carbonTokenServiceMock.getTokenDetails.mockResolvedValue(mockToken);

      const res = await request(makeApp())
        .get('/api/carbon-credits/CCT-TRIP-900-1700000000');

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(mockToken);
    });

    it('rejects invalid token format in route param with 400', async () => {
      const res = await request(makeApp())
        .get('/api/carbon-credits/bad%20spaced%20id');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid tokenId format/i);
    });

    it('returns 404 when token does not exist', async () => {
      carbonTokenServiceMock.getTokenDetails.mockResolvedValue(null);

      const res = await request(makeApp())
        .get('/api/carbon-credits/CCT-TRIP-NONE-111');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });
});
