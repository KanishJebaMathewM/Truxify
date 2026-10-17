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

let mockUser = { id: 'usr-carrier-77', role: 'carrier' };

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const arLoadingOptimizerServiceMock = vi.hoisted(() => ({
  generateLoadingPlan: vi.fn(),
  getLoadingPlan: vi.fn(),
}));

vi.mock('../../src/services/arLoadingOptimizerService.js', () => ({
  arLoadingOptimizerService: arLoadingOptimizerServiceMock,
}));

const {
  default: arLoadingRouter,
  isValidContainerSpecs,
  isValidPallet,
  isValidPlanId,
} = await import('../../src/routes/arLoadingRoutes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ar-loading', arLoadingRouter);
  return app;
}

describe('arLoadingRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'usr-carrier-77', role: 'carrier' };
  });

  describe('Validation Helpers', () => {
    it('validates container specifications', () => {
      expect(isValidContainerSpecs({ lengthCm: 1615, widthCm: 259, heightCm: 280, maxPayloadKg: 20000 })).toBe(true);
      expect(isValidContainerSpecs({})).toBe(true);
      expect(isValidContainerSpecs({ lengthCm: 50 })).toBe(false); // too short
      expect(isValidContainerSpecs({ widthCm: 600 })).toBe(false); // too wide
      expect(isValidContainerSpecs({ maxPayloadKg: 0 })).toBe(false);
      expect(isValidContainerSpecs(null)).toBe(false);
    });

    it('validates pallet specifications', () => {
      expect(isValidPallet({ lengthCm: 120, widthCm: 100, heightCm: 150, weightKg: 800 })).toBe(true);
      expect(isValidPallet({})).toBe(true);
      expect(isValidPallet({ lengthCm: 5 })).toBe(false);
      expect(isValidPallet({ weightKg: -50 })).toBe(false);
      expect(isValidPallet({ weightKg: 30000 })).toBe(false);
      expect(isValidPallet(null)).toBe(false);
    });

    it('validates plan IDs', () => {
      expect(isValidPlanId('PLAN-a1b2c3d4e5f6')).toBe(true);
      expect(isValidPlanId('PLAN-12345678-uuid')).toBe(true);
      expect(isValidPlanId('INVALID-ID')).toBe(false);
      expect(isValidPlanId('PLAN-')).toBe(false);
      expect(isValidPlanId(null)).toBe(false);
    });
  });

  describe('POST /api/ar-loading/optimize', () => {
    const validPayload = {
      container: { lengthCm: 1615, widthCm: 259, heightCm: 280, maxPayloadKg: 20000 },
      pallets: [
        { id: 'PLT-1', lengthCm: 120, widthCm: 100, heightCm: 150, weightKg: 650 },
        { id: 'PLT-2', lengthCm: 120, widthCm: 100, heightCm: 150, weightKg: 700 },
      ],
    };

    it('generates 3D AR loading plan for authorized carrier', async () => {
      const mockPlan = {
        planId: 'PLAN-a1b2c3d4e5f6',
        totalWeightKg: 1350,
        placedPallets: [
          { palletId: 'PLT-1', stepNumber: 1 },
          { palletId: 'PLT-2', stepNumber: 2 },
        ],
      };
      arLoadingOptimizerServiceMock.generateLoadingPlan.mockResolvedValue(mockPlan);

      const res = await request(makeApp())
        .post('/api/ar-loading/optimize')
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/loading plan generated successfully/i);
      expect(res.body.plan).toEqual(mockPlan);
      expect(arLoadingOptimizerServiceMock.generateLoadingPlan).toHaveBeenCalledWith({
        ownerId: 'usr-carrier-77',
        container: validPayload.container,
        pallets: validPayload.pallets,
      });
    });

    it('allows driver and dispatcher roles to generate loading plans', async () => {
      mockUser = { id: 'usr-driver-2', role: 'driver' };
      arLoadingOptimizerServiceMock.generateLoadingPlan.mockResolvedValue({ planId: 'PLAN-1' });

      const res = await request(makeApp())
        .post('/api/ar-loading/optimize')
        .send(validPayload);

      expect(res.status).toBe(201);
    });

    it('denies unauthorized role (e.g. shipper) with 403 Forbidden', async () => {
      mockUser = { id: 'usr-shipper-4', role: 'shipper' };

      const res = await request(makeApp())
        .post('/api/ar-loading/optimize')
        .send(validPayload);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
      expect(arLoadingOptimizerServiceMock.generateLoadingPlan).not.toHaveBeenCalled();
    });

    it('rejects missing or empty pallets list with 400', async () => {
      const res = await request(makeApp())
        .post('/api/ar-loading/optimize')
        .send({ pallets: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing or empty pallets array/i);
    });

    it('rejects batch exceeding max pallets limit with 400', async () => {
      const hugePallets = Array.from({ length: 101 }, (_, i) => ({
        id: `PLT-${i}`,
        weightKg: 100,
      }));

      const res = await request(makeApp())
        .post('/api/ar-loading/optimize')
        .send({ pallets: hugePallets });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Exceeded maximum permissible pallets limit/i);
    });

    it('rejects invalid container dimensions with 400', async () => {
      const res = await request(makeApp())
        .post('/api/ar-loading/optimize')
        .send({
          ...validPayload,
          container: { lengthCm: 10 }, // Below 100cm minimum
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid container specifications/i);
    });

    it('rejects invalid pallet parameters with 400', async () => {
      const res = await request(makeApp())
        .post('/api/ar-loading/optimize')
        .send({
          ...validPayload,
          pallets: [{ lengthCm: 120, weightKg: -10 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid pallet specifications at index 0/i);
    });

    it('handles unexpected optimizer failure with 500', async () => {
      arLoadingOptimizerServiceMock.generateLoadingPlan.mockRejectedValue(
        new Error('3D packing solver timeout')
      );

      const res = await request(makeApp())
        .post('/api/ar-loading/optimize')
        .send(validPayload);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('3D packing solver timeout');
    });
  });

  describe('GET /api/ar-loading/plan/:planId', () => {
    it('returns plan details for valid planId', async () => {
      const mockPlan = {
        planId: 'PLAN-a1b2c3d4e5f6',
        status: 'OPTIMIZED',
      };
      arLoadingOptimizerServiceMock.getLoadingPlan.mockResolvedValue(mockPlan);

      const res = await request(makeApp())
        .get('/api/ar-loading/plan/PLAN-a1b2c3d4e5f6');

      expect(res.status).toBe(200);
      expect(res.body.plan).toEqual(mockPlan);
    });

    it('rejects invalid planId format with 400', async () => {
      const res = await request(makeApp())
        .get('/api/ar-loading/plan/bad-id');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid planId format/i);
    });

    it('returns 404 when plan is not found', async () => {
      arLoadingOptimizerServiceMock.getLoadingPlan.mockResolvedValue(null);

      const res = await request(makeApp())
        .get('/api/ar-loading/plan/PLAN-999999999999');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('POST /api/ar-loading/verify/:planId', () => {
    it('verifies physical completion of AR loading plan', async () => {
      const activePlan = {
        planId: 'PLAN-a1b2c3d4e5f6',
        status: 'OPTIMIZED',
      };
      arLoadingOptimizerServiceMock.getLoadingPlan.mockResolvedValue(activePlan);

      const res = await request(makeApp())
        .post('/api/ar-loading/verify/PLAN-a1b2c3d4e5f6');

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/verified successfully/i);
      expect(res.body.plan.status).toBe('VERIFIED_PHYSICALLY_LOADED');
      expect(res.body.plan.verifiedBy).toBe('usr-carrier-77');
      expect(res.body.plan.verifiedAt).toBeDefined();
    });

    it('returns 404 if plan to verify is not found', async () => {
      arLoadingOptimizerServiceMock.getLoadingPlan.mockResolvedValue(null);

      const res = await request(makeApp())
        .post('/api/ar-loading/verify/PLAN-000000000000');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });
});
