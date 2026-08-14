import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1', role: 'driver' }; next(); },
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  safeIpKeyGenerator: () => 'test-ip',
  createStore: vi.fn(() => ({})),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (req, _res, next) => { req.body = req.body || {}; next(); },
}));

const { dbMock, svcMock, policyMock } = vi.hoisted(() => ({
  dbMock: { supabase: { from: vi.fn() } },
  svcMock: { oracleService: { confirmDelivery: vi.fn(), verifyCrossChain: vi.fn() } },
  policyMock: {
    policy: { authorize: vi.fn() },
    PolicyError: class extends Error { constructor(status, message) { super(message); this.status = status; } },
  },
}));

vi.mock('../../src/core/container.js', () => svcMock);
vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock.supabase; },
}));
vi.mock('../../src/security/policyEngine.js', () => policyMock);
vi.mock('../../src/validation/requestSchemas.js', () => ({
  oracleConfirmSchema: {},
  oracleVerifyCrosschainSchema: {},
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
    policyMock.policy.authorize.mockReturnValue(true);
    svcMock.oracleService.confirmDelivery.mockResolvedValue({ confirmed: true, consensusCount: 3 });
    svcMock.oracleService.verifyCrossChain.mockResolvedValue({ verified: true, ipfsHash: 'ipfs-1' });
  });

  describe('GET /oracle/status', () => {
    it('returns provider status', async () => {
      const res = await request(makeApp()).get('/oracle/status');
      expect(res.status).toBe(200);
      expect(res.body.data.providers).toBe(3);
    });
  });

  describe('POST /oracle/confirm', () => {
    it('returns 404 when the order is not found', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) })),
      });
      const res = await request(makeApp()).post('/oracle/confirm').send({ orderId: 'o1', otp: '123456' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Order not found');
    });

    it('returns the confirmation result on success', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'o1', customer_id: 'u1', driver_id: null }, error: null }) })) })),
      });
      const res = await request(makeApp()).post('/oracle/confirm').send({ orderId: 'o1', otp: '123456' });
      expect(res.status).toBe(200);
      expect(res.body.data.confirmed).toBe(true);
    });
  });

  describe('POST /oracle/verify-crosschain', () => {
    it('returns the cross-chain result on success', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'o1', customer_id: 'u1', driver_id: null }, error: null }) })) })),
      });
      const res = await request(makeApp()).post('/oracle/verify-crosschain').send({ orderId: 'o1', blockchainHash: '0xabc' });
      expect(res.status).toBe(200);
      expect(res.body.data.verified).toBe(true);
    });
  });
});
