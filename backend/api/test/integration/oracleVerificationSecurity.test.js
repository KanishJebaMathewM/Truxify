import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Mocks ───────────────────────────────────────────────────────────────
// The oracle and verification services are simple stub implementations.
// We mock them to avoid hitting external providers and to isolate route
// security testing from business logic.

vi.mock('../../src/config/db.js', () => ({
  supabase: null,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

vi.mock('../../src/oracle/OracleService.js', () => {
  return {
    default: class MockOracleService {
      constructor() {
        this.providers = [{ name: 'TestProvider' }];
        this.consensusThreshold = 1;
      }
      confirmDelivery = vi.fn().mockResolvedValue({
        confirmed: true,
        consensusCount: 1,
        threshold: 1,
        totalProviders: 1,
        providerResults: [{ status: 'fulfilled', value: { confirmed: true } }],
        timestamp: new Date().toISOString(),
      });
      verifyCrossChain = vi.fn().mockResolvedValue({
        verified: true,
        ipfsHash: 'QmTestHash123',
        blockchainHash: '0xabc123',
        verificationUrl: 'https://ipfs.io/ipfs/QmTestHash123',
      });
    },
  };
});

vi.mock('../../src/services/verification/VerificationService.js', () => {
  return {
    default: class MockVerificationService {
      verifyOrder = vi.fn().mockResolvedValue({
        orderId: '550e8400-e29b-41d4-a716-446655440000',
        deliveryVerified: true,
        timestamp: new Date().toISOString(),
      });
      checkDocumentIntegrity = vi.fn().mockResolvedValue({
        verified: true,
        documentsChecked: ['RC', 'License', 'Insurance'],
        lastCheck: new Date().toISOString(),
      });
    },
  };
});

// ── Import routes AFTER mocks ──────────────────────────────────────────
const { default: oracleRouter } = await import('../../src/routes/oracleRoutes.js');
const { default: verificationRouter } = await import('../../src/routes/verificationRoutes.js');

// ── Test apps ──────────────────────────────────────────────────────────
function buildOracleApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/oracle', oracleRouter);
  return app;
}

function buildVerifyApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/verify', verificationRouter);
  return app;
}

const USER_HEADERS = {
  'x-user-id': 'user-1',
  'x-user-role': 'customer',
};

const DRIVER_HEADERS = {
  'x-user-id': 'driver-1',
  'x-user-role': 'driver',
};

// ── Helper: valid request bodies ───────────────────────────────────────
const VALID_ORDER_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_DRIVER_ID = '660e8400-e29b-41d4-a716-446655440001';

const validConfirmBody = {
  orderId: VALID_ORDER_ID,
  otp: '123456',
  gpsCoordinates: { lat: 28.6139, lng: 77.2090 },
};

const validCrosschainBody = {
  orderId: VALID_ORDER_ID,
  blockchainHash: '0xabc123def456',
};

// ════════════════════════════════════════════════════════════════════════
// Oracle Routes
// ════════════════════════════════════════════════════════════════════════

describe('Oracle Routes — Authentication', () => {
  it('GET /status returns 401 without auth headers', async () => {
    const app = buildOracleApp();
    const res = await request(app).get('/api/oracle/status');
    expect(res.status).toBe(401);
  });

  it('GET /status returns 200 with valid auth', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .get('/api/oracle/status')
      .set(USER_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /confirm returns 401 without auth headers', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/confirm')
      .send(validConfirmBody);
    expect(res.status).toBe(401);
  });

  it('POST /confirm returns 200 with valid auth', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/confirm')
      .set(USER_HEADERS)
      .send(validConfirmBody);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /verify-crosschain returns 401 without auth headers', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/verify-crosschain')
      .send(validCrosschainBody);
    expect(res.status).toBe(401);
  });

  it('POST /verify-crosschain returns 200 with valid auth', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/verify-crosschain')
      .set(USER_HEADERS)
      .send(validCrosschainBody);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Oracle Routes — Request Validation', () => {
  it('POST /confirm returns 400 when body is empty', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/confirm')
      .set(USER_HEADERS)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'orderId' }),
      ])
    );
  });

  it('POST /confirm returns 400 for invalid orderId format', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/confirm')
      .set(USER_HEADERS)
      .send({ ...validConfirmBody, orderId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'orderId' }),
      ])
    );
  });

  it('POST /confirm returns 400 for invalid OTP format', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/confirm')
      .set(USER_HEADERS)
      .send({ ...validConfirmBody, otp: '12345' }); // 5 digits
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'otp' }),
      ])
    );
  });

  it('POST /confirm returns 400 for non-numeric OTP', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/confirm')
      .set(USER_HEADERS)
      .send({ ...validConfirmBody, otp: 'abcdef' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'otp' }),
      ])
    );
  });

  it('POST /confirm returns 400 when gpsCoordinates is missing', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/confirm')
      .set(USER_HEADERS)
      .send({ orderId: VALID_ORDER_ID, otp: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'gpsCoordinates' }),
      ])
    );
  });

  it('POST /confirm returns 400 for latitude out of range', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/confirm')
      .set(USER_HEADERS)
      .send({
        ...validConfirmBody,
        gpsCoordinates: { lat: 200, lng: 77.2090 },
      });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'gpsCoordinates.lat' }),
      ])
    );
  });

  it('POST /confirm rejects extra fields (strict mode)', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/confirm')
      .set(USER_HEADERS)
      .send({ ...validConfirmBody, extraField: 'should be rejected' });
    expect(res.status).toBe(400);
  });

  it('POST /verify-crosschain returns 400 when body is empty', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/verify-crosschain')
      .set(USER_HEADERS)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('POST /verify-crosschain returns 400 for invalid blockchainHash', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/verify-crosschain')
      .set(USER_HEADERS)
      .send({ ...validCrosschainBody, blockchainHash: 'not-hex' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'blockchainHash' }),
      ])
    );
  });

  it('POST /verify-crosschain returns 400 for orderId that is not a UUID', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/verify-crosschain')
      .set(USER_HEADERS)
      .send({ ...validCrosschainBody, orderId: '12345' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'orderId' }),
      ])
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
// Verification Routes
// ════════════════════════════════════════════════════════════════════════

describe('Verification Routes — Authentication', () => {
  it('GET /order/:orderId returns 401 without auth headers', async () => {
    const app = buildVerifyApp();
    const res = await request(app).get(`/api/verify/order/${VALID_ORDER_ID}`);
    expect(res.status).toBe(401);
  });

  it('GET /order/:orderId returns 200 with valid auth', async () => {
    const app = buildVerifyApp();
    const res = await request(app)
      .get(`/api/verify/order/${VALID_ORDER_ID}`)
      .set(USER_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /documents/check returns 401 without auth headers', async () => {
    const app = buildVerifyApp();
    const res = await request(app)
      .post('/api/verify/documents/check')
      .send({ driverId: VALID_DRIVER_ID });
    expect(res.status).toBe(401);
  });

  it('POST /documents/check returns 200 with valid auth', async () => {
    const app = buildVerifyApp();
    const res = await request(app)
      .post('/api/verify/documents/check')
      .set(DRIVER_HEADERS)
      .send({ driverId: VALID_DRIVER_ID });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Verification Routes — Request Validation', () => {
  it('GET /order/:orderId returns 400 for invalid UUID param', async () => {
    const app = buildVerifyApp();
    const res = await request(app)
      .get('/api/verify/order/not-a-uuid')
      .set(USER_HEADERS);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'orderId' }),
      ])
    );
  });

  it('POST /documents/check returns 400 when body is empty', async () => {
    const app = buildVerifyApp();
    const res = await request(app)
      .post('/api/verify/documents/check')
      .set(DRIVER_HEADERS)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'driverId' }),
      ])
    );
  });

  it('POST /documents/check returns 400 for invalid driverId format', async () => {
    const app = buildVerifyApp();
    const res = await request(app)
      .post('/api/verify/documents/check')
      .set(DRIVER_HEADERS)
      .send({ driverId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'driverId' }),
      ])
    );
  });

  it('POST /documents/check rejects extra fields (strict mode)', async () => {
    const app = buildVerifyApp();
    const res = await request(app)
      .post('/api/verify/documents/check')
      .set(DRIVER_HEADERS)
      .send({ driverId: VALID_DRIVER_ID, extra: 'nope' });
    expect(res.status).toBe(400);
  });
});
