import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  safeIpKeyGenerator: () => 'test-ip',
  createStore: vi.fn(() => ({})),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateParams: () => (_req, _res, next) => next(),
  validateBody: () => (_req, _res, next) => next(),
}));

vi.mock('multer', () => {
  const single = () => (req, _res, next) => {
    req.file = req.file || { buffer: Buffer.from('fake-image'), mimetype: 'image/jpeg', originalname: 'doc.jpg' };
    next();
  };
  const multerFn = () => ({ single });
  multerFn.memoryStorage = () => ({});
  multerFn.MemoryStorage = class {};
  return { default: multerFn };
});

const { dbMock, svcMock, dlMock, policyMock } = vi.hoisted(() => ({
  dbMock: { supabase: { from: vi.fn() }, supabaseAdmin: { from: vi.fn() }, createUserClient: vi.fn() },
  svcMock: { verificationService: { verifyOrder: vi.fn(), checkDocumentIntegrity: vi.fn() } },
  dlMock: { exchangeCode: vi.fn(), verifyDocuments: vi.fn() },
  policyMock: {
    policy: { authorize: vi.fn() },
    PolicyError: class extends Error { constructor(status, message) { super(message); this.status = status; } },
  },
}));

vi.mock('../../src/core/container.js', () => svcMock);
vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock.supabase; },
  get supabaseAdmin() { return dbMock.supabaseAdmin; },
  createUserClient: (token) => dbMock.createUserClient(token),
}));
vi.mock('../../src/security/policyEngine.js', () => policyMock);
vi.mock('../../src/services/digilockerService.js', () => ({ default: dlMock }));
vi.mock('../../src/lib/malwareScanner.js', () => ({
  scanDocument: vi.fn().mockResolvedValue({ clean: true }),
  MalwareScanError: class extends Error {},
}));
vi.mock('../../src/lib/documentValidation.js', () => ({
  validateDocumentBuffer: vi.fn().mockReturnValue('image/jpeg'),
  DocumentValidationError: class extends Error {},
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import verificationRoutes from '../../src/routes/verificationRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/verification', verificationRoutes);
  return app;
}

describe('verificationRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.createUserClient.mockReturnValue(dbMock.supabase);
    policyMock.policy.authorize.mockReturnValue(true);
    svcMock.verificationService.verifyOrder.mockResolvedValue({ verified: true, orderId: 'o1' });
  });

  describe('GET /verification/order/:orderId', () => {
    it('returns 404 when the order is not found', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) })),
      });
      const res = await request(makeApp()).get('/verification/order/o1');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Order not found');
    });

    it('returns the verification result on success', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'o1', customer_id: 'u1', driver_id: null }, error: null }) })) })),
      });
      const res = await request(makeApp()).get('/verification/order/o1');
      expect(res.status).toBe(200);
      expect(res.body.data.verified).toBe(true);
    });

    it('reads the order with the user-scoped client (createUserClient), not the anon client', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'o1', customer_id: 'u1', driver_id: null }, error: null }) })) })),
      });
      const res = await request(makeApp()).get('/verification/order/o1');
      expect(res.status).toBe(200);
      expect(dbMock.createUserClient).toHaveBeenCalled();
      expect(dbMock.supabase.from).toHaveBeenCalledWith('orders');
    });
  });

  describe('POST /verification/kyc/upload', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
      delete process.env.ML_API_URL;
      delete process.env.ML_API_KEY;
    });

    function mockOcr(jsonBody) {
      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => jsonBody,
      }));
    }

    it('does NOT mark KYC Verified on OCR verified:true without government attestation', async () => {
      const updateMock = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
      dbMock.supabaseAdmin.from.mockReturnValue({ update: updateMock });
      process.env.ML_API_URL = 'http://ml';
      process.env.ML_API_KEY = 'key';
      mockOcr({ verified: true, extracted_number: 'AB1234567' });

      const res = await request(makeApp()).post('/verification/kyc/upload').send({});

      expect(res.status).toBe(200);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ kyc_status: 'Rejected' }),
      );
      expect(updateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ kyc_status: 'Verified' }),
      );
    });

    it('marks KYC Verified only when OCR verified AND government attested', async () => {
      const updateMock = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
      dbMock.supabaseAdmin.from.mockReturnValue({ update: updateMock });
      process.env.ML_API_URL = 'http://ml';
      process.env.ML_API_KEY = 'key';
      mockOcr({ verified: true, attested: true, extracted_number: 'AB 123 4567' });

      const res = await request(makeApp()).post('/verification/kyc/upload').send({});

      expect(res.status).toBe(200);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ kyc_status: 'Verified', kyc_doc_number: 'AB1234567' }),
      );
    });
  });
});
