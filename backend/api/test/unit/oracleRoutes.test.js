import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { authMock, dbMock, svcMock, policyMock, validateMock } = vi.hoisted(() => ({
  authMock: {
    authenticatedUser: { id: 'u1', role: 'driver' },
    isAuthenticated: true,
  },
  dbMock: {
    supabase: { from: vi.fn() },
    createUserClient: vi.fn(),
  },
  svcMock: {
    oracleService: {
      getStatus: vi.fn(),
      confirmDelivery: vi.fn(),
      verifyCrossChain: vi.fn(),
    },
  },
  policyMock: {
    policy: { authorize: vi.fn() },
    PolicyError: class extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    },
  },
  validateMock: {
    validateBody: (schema) => (req, res, next) => {
      if (req.body && req.body.__validationError) {
        return res.status(400).json({ success: false, error: req.body.__validationError });
      }
      next();
    },
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    if (!authMock.isAuthenticated) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = authMock.authenticatedUser;
    next();
  },
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  safeIpKeyGenerator: () => 'test-ip',
  createStore: vi.fn(() => ({})),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: validateMock.validateBody,
}));

vi.mock('../../src/core/container.js', () => svcMock);

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  get supabase() {
    return dbMock.supabase;
  },
  createUserClient: (...args) => dbMock.createUserClient(...args),
}));

vi.mock('../../src/security/policyEngine.js', () => policyMock);

vi.mock('../../src/validation/requestSchemas.js', () => ({
  oracleConfirmSchema: { name: 'oracleConfirmSchema' },
  oracleVerifyCrosschainSchema: { name: 'oracleVerifyCrosschainSchema' },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import oracleRoutes from '../../src/routes/oracleRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/oracle', oracleRoutes);
  return app;
}

describe('oracleRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.isAuthenticated = true;
    authMock.authenticatedUser = { id: 'u1', role: 'driver' };
    policyMock.policy.authorize.mockReturnValue(true);
    svcMock.oracleService.getStatus.mockReturnValue({
      providers: 3,
      threshold: 2,
      healthy: true,
      lastSync: '2026-09-15T12:00:00.000Z',
    });
    svcMock.oracleService.confirmDelivery.mockResolvedValue({
      confirmed: true,
      consensusCount: 3,
      txHash: '0x123',
    });
    svcMock.oracleService.verifyCrossChain.mockResolvedValue({
      verified: true,
      ipfsHash: 'ipfs-hash-1',
      blockNumber: 1234567,
    });
  });

  describe('Route mounting and export', () => {
    it('exports an express router instance', () => {
      expect(oracleRoutes).toBeDefined();
      expect(typeof oracleRoutes).toBe('function');
    });

    it('returns 404 for unknown oracle endpoints', async () => {
      const res = await request(makeApp()).get('/oracle/unknown-endpoint');
      expect(res.status).toBe(404);
    });
  });

  describe('Authentication requirements', () => {
    beforeEach(() => {
      authMock.isAuthenticated = false;
    });

    it('rejects unauthenticated GET /oracle/status with 401', async () => {
      const res = await request(makeApp()).get('/oracle/status');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('rejects unauthenticated POST /oracle/confirm with 401', async () => {
      const res = await request(makeApp()).post('/oracle/confirm').send({ orderId: 'o1', otp: '123456' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('rejects unauthenticated POST /oracle/verify-crosschain with 401', async () => {
      const blockchainHash = `0x${'a'.repeat(64)}`;
      const res = await request(makeApp()).post('/oracle/verify-crosschain').send({ orderId: 'o1', blockchainHash });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });

  describe('GET /oracle/status', () => {
    it('returns 200 with oracle provider and consensus status', async () => {
      const res = await request(makeApp()).get('/oracle/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          providers: 3,
          threshold: 2,
          healthy: true,
          lastSync: '2026-09-15T12:00:00.000Z',
        },
      });
      expect(svcMock.oracleService.getStatus).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when oracleService.getStatus throws an error', async () => {
      svcMock.oracleService.getStatus.mockImplementation(() => {
        throw new Error('Oracle provider unreachable');
      });

      const res = await request(makeApp()).get('/oracle/status');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: 'Internal Server Error',
      });
    });
  });

  describe('POST /oracle/confirm', () => {
    it('validates request payload and rejects validation errors', async () => {
      const res = await request(makeApp())
        .post('/oracle/confirm')
        .send({ __validationError: 'otp is required' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'otp is required',
      });
    });

    it('returns 404 when the order is not found', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      });

      const res = await request(makeApp()).post('/oracle/confirm').send({ orderId: 'o-nonexistent', otp: '123456' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: 'Order not found',
      });
    });

    it('returns 500 when order lookup database query fails', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database connection failed' } }),
          })),
        })),
      });

      const res = await request(makeApp()).post('/oracle/confirm').send({ orderId: 'o1', otp: '123456' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: 'Failed to verify order access',
      });
    });

    it('returns 403 when policy engine denies authorization', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'o1', customer_id: 'other-user', driver_id: null },
              error: null,
            }),
          })),
        })),
      });

      policyMock.policy.authorize.mockImplementation(() => {
        throw new policyMock.PolicyError(403, 'Unauthorized access to order');
      });

      const res = await request(makeApp()).post('/oracle/confirm').send({ orderId: 'o1', otp: '123456' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        error: 'Unauthorized access to order',
      });
    });

    it('returns 200 with confirmation result on success', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'o1', customer_id: 'u1', driver_id: null },
              error: null,
            }),
          })),
        })),
      });

      const res = await request(makeApp()).post('/oracle/confirm').send({
        orderId: 'o1',
        otp: '123456',
        gpsCoordinates: { lat: 18.5204, lng: 73.8567 },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          confirmed: true,
          consensusCount: 3,
          txHash: '0x123',
        },
      });
      expect(svcMock.oracleService.confirmDelivery).toHaveBeenCalledWith({
        orderId: 'o1',
        otp: '123456',
        gpsCoordinates: { lat: 18.5204, lng: 73.8567 },
      });
    });

    it('returns 500 when oracleService.confirmDelivery fails', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'o1', customer_id: 'u1', driver_id: null },
              error: null,
            }),
          })),
        })),
      });

      svcMock.oracleService.confirmDelivery.mockRejectedValue(new Error('Consensus threshold not reached'));

      const res = await request(makeApp()).post('/oracle/confirm').send({ orderId: 'o1', otp: '123456' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: 'Internal Server Error',
      });
    });
  });

  describe('POST /oracle/verify-crosschain', () => {
    it('rejects malformed transaction hashes with 400 before DB or service calls', async () => {
      const res = await request(makeApp())
        .post('/oracle/verify-crosschain')
        .send({ orderId: 'o1', blockchainHash: '0xinvalidhash' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'blockchainHash must be a 0x-prefixed 32-byte hex string',
      });
      expect(dbMock.supabase.from).not.toHaveBeenCalled();
      expect(svcMock.oracleService.verifyCrossChain).not.toHaveBeenCalled();
    });

    it('returns 404 when order is not found during crosschain verification', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      });

      const blockchainHash = `0x${'b'.repeat(64)}`;
      const res = await request(makeApp())
        .post('/oracle/verify-crosschain')
        .send({ orderId: 'o-unknown', blockchainHash });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: 'Order not found',
      });
    });

    it('returns 200 with cross-chain verification details on success', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'o1', customer_id: 'u1', driver_id: null },
              error: null,
            }),
          })),
        })),
      });

      const blockchainHash = `0x${'c'.repeat(64)}`;
      const res = await request(makeApp())
        .post('/oracle/verify-crosschain')
        .send({ orderId: 'o1', blockchainHash });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          verified: true,
          ipfsHash: 'ipfs-hash-1',
          blockNumber: 1234567,
        },
      });
      expect(svcMock.oracleService.verifyCrossChain).toHaveBeenCalledWith('o1', blockchainHash);
    });

    it('returns 500 when oracleService.verifyCrossChain throws an error', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'o1', customer_id: 'u1', driver_id: null },
              error: null,
            }),
          })),
        })),
      });

      svcMock.oracleService.verifyCrossChain.mockRejectedValue(new Error('Cross-chain RPC timeout'));

      const blockchainHash = `0x${'d'.repeat(64)}`;
      const res = await request(makeApp())
        .post('/oracle/verify-crosschain')
        .send({ orderId: 'o1', blockchainHash });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: 'Internal Server Error',
      });
    });
  });
});
