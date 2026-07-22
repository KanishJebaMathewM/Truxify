import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const VALID_ORDER_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_DRIVER_ID = '660e8400-e29b-41d4-a716-446655440001';

const mockOracleService = {
  confirmDelivery: vi.fn().mockResolvedValue({
    confirmed: true,
    consensusCount: 3,
    threshold: 2,
    totalProviders: 3,
    providerResults: [
      { confirmed: true, provider: 'OTPVerifier' },
      { confirmed: true, provider: 'GPSVerifier' },
      { confirmed: true, provider: 'StatusVerifier' },
    ],
    timestamp: new Date().toISOString(),
  }),
  verifyCrossChain: vi.fn().mockResolvedValue({
    verified: true,
    ipfsHash: '0xabc123',
    blockchainHash: '0xabc123',
    verificationUrl: 'https://polygonscan.com/tx/0xabc123',
  }),
};

const mockVerificationService = {
  verifyOrder: vi.fn().mockResolvedValue({
    orderId: VALID_ORDER_ID,
    deliveryVerified: true,
    oracleDetails: {
      confirmed: true,
      consensusCount: 3,
      threshold: 2,
      totalProviders: 3,
      providerResults: [],
      timestamp: new Date().toISOString(),
    },
    crossChainVerified: true,
    ipfsHash: '0xabc123',
    documentIntegrity: {
      verified: true,
      documentsChecked: [
        { type: 'rc_book', uploaded: true, status: 'approved' },
        { type: 'driving_licence', uploaded: true, status: 'approved' },
      ],
      lastCheck: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  }),
  checkDocumentIntegrity: vi.fn().mockResolvedValue({
    verified: true,
    documentsChecked: [
      { type: 'rc_book', uploaded: true, status: 'approved' },
      { type: 'driving_licence', uploaded: true, status: 'approved' },
    ],
    lastCheck: new Date().toISOString(),
  }),
};

vi.mock('../../src/core/container.js', () => ({
  oracleService: mockOracleService,
  verificationService: mockVerificationService,
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: null,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: oracleRouter } = await import('../../src/routes/oracleRoutes.js');
const { default: verificationRouter } = await import('../../src/routes/verificationRoutes.js');

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

const validConfirmBody = {
  orderId: VALID_ORDER_ID,
  otp: '123456',
  gpsCoordinates: { lat: 28.6139, lng: 77.2090 },
};

const validCrosschainBody = {
  orderId: VALID_ORDER_ID,
  blockchainHash: '0xabc123def456',
};

describe('Oracle Routes — Authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      .send({ ...validConfirmBody, otp: '12345' });
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

describe('Verification Routes — Authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

describe('Verification Routes — Response Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /order/:orderId returns correct contract', async () => {
    const app = buildVerifyApp();
    const res = await request(app)
      .get(`/api/verify/order/${VALID_ORDER_ID}`)
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('orderId');
    expect(res.body.data).toHaveProperty('deliveryVerified');
    expect(typeof res.body.data.deliveryVerified).toBe('boolean');
    expect(res.body.data).toHaveProperty('oracleDetails');
    expect(res.body.data).toHaveProperty('crossChainVerified');
    expect(typeof res.body.data.crossChainVerified).toBe('boolean');
    expect(res.body.data).toHaveProperty('documentIntegrity');
    expect(res.body.data).toHaveProperty('timestamp');
  });

  it('POST /documents/check returns correct contract', async () => {
    const app = buildVerifyApp();
    const res = await request(app)
      .post('/api/verify/documents/check')
      .set(DRIVER_HEADERS)
      .send({ driverId: VALID_DRIVER_ID });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('verified');
    expect(typeof res.body.data.verified).toBe('boolean');
    expect(res.body.data).toHaveProperty('documentsChecked');
    expect(Array.isArray(res.body.data.documentsChecked)).toBe(true);
    expect(res.body.data).toHaveProperty('lastCheck');
  });

  it('POST /oracle/confirm returns correct contract', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/confirm')
      .set(USER_HEADERS)
      .send(validConfirmBody);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('confirmed');
    expect(typeof res.body.data.confirmed).toBe('boolean');
    expect(res.body.data).toHaveProperty('consensusCount');
    expect(res.body.data).toHaveProperty('threshold');
    expect(res.body.data).toHaveProperty('totalProviders');
    expect(res.body.data).toHaveProperty('providerResults');
    expect(res.body.data).toHaveProperty('timestamp');
  });

  it('POST /oracle/verify-crosschain returns correct contract', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .post('/api/oracle/verify-crosschain')
      .set(USER_HEADERS)
      .send(validCrosschainBody);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('verified');
    expect(typeof res.body.data.verified).toBe('boolean');
    expect(res.body.data).toHaveProperty('ipfsHash');
    expect(res.body.data).toHaveProperty('blockchainHash');
    expect(res.body.data).toHaveProperty('verificationUrl');
  });

  it('GET /oracle/status returns correct contract', async () => {
    const app = buildOracleApp();
    const res = await request(app)
      .get('/api/oracle/status')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('providers');
    expect(typeof res.body.data.providers).toBe('number');
    expect(res.body.data).toHaveProperty('threshold');
    expect(res.body.data).toHaveProperty('timestamp');
  });
});
