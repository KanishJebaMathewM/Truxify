/**
 * Integration tests for Node.js ML proxy layer (backend/api/src/routes/mlRoutes.js)
 *
 * Covers:
 *   - POST /api/ml/eta with valid payload -> proxies to FastAPI, returns { eta_minutes, confidence }
 *   - POST /api/ml/eta when FastAPI returns 422 -> Node returns 400 with error detail
 *   - POST /api/ml/eta when FastAPI is unreachable -> Node returns 503 { error: 'ML_SERVICE_UNAVAILABLE' }
 *   - POST /api/ml/eta when FastAPI returns unexpected schema -> Node returns 502 { error: 'ML_INVALID_SCHEMA' }
 *   - POST /api/ml/pricing -> response matches OpenAPI schema (PricePredictOutput)
 *   - POST /api/ml/vrp with oversized payload -> Node enforces request size limit before forwarding (413)
 *   - POST /api/ml/vrp with valid payload -> proxies to FastAPI
 *   - All ML routes require valid JWT -> 401 on missing or invalid token
 *
 * Test setup: Uses nock to mock FastAPI responses. Uses supertest for Express route testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import nock from 'nock';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../../src/config/jwtSecret.js';

const FASTAPI_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Mock database and cache dependencies to ensure isolated test execution
vi.mock('../../src/config/db.js', () => ({
  supabase: null,
  supabaseAdmin: null,
  createUserClient: null,
  firebaseAdmin: {
    auth: () => ({
      verifyIdToken: vi.fn().mockRejectedValue(new Error('Firebase ID token has invalid signature')),
    }),
  },
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
}));

const { default: mlRouter } = await import('../../src/routes/mlRoutes.js');

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/ml', mlRouter);
  return app;
}

describe('ML Routes Proxy Integration Tests', () => {
  let app;
  let validToken;
  let authHeader;
  const originalBypassAuth = process.env.BYPASS_AUTH;
  const originalEnableTestAuth = process.env.ENABLE_TEST_AUTH;
  const originalTimeout = process.env.ML_REQUEST_TIMEOUT_MS;

  beforeEach(() => {
    // Enforce real JWT authentication verification
    process.env.BYPASS_AUTH = 'false';
    process.env.ENABLE_TEST_AUTH = 'false';
    process.env.ML_REQUEST_TIMEOUT_MS = '1000';

    const secret = getJwtSecret();
    validToken = jwt.sign(
      { id: 'usr-ml-integration', role: 'customer', email: 'ml-test@truxify.com' },
      secret,
      { expiresIn: '1h' },
    );
    authHeader = `Bearer ${validToken}`;

    if (!nock.isActive()) {
      nock.activate();
    }
    nock.cleanAll();
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    app = createTestApp();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    process.env.BYPASS_AUTH = originalBypassAuth;
    process.env.ENABLE_TEST_AUTH = originalEnableTestAuth;
    process.env.ML_REQUEST_TIMEOUT_MS = originalTimeout;
  });

  describe('POST /api/ml/eta', () => {
    it('with valid payload -> proxies to FastAPI, returns { eta_minutes, confidence }', async () => {
      const payload = {
        route_distance: 25.5,
        time_of_day: 14,
        day_of_week: 2,
        route_type: 'highway',
        historical_speed: 60,
      };

      const fastApiResponse = {
        eta_minutes: 32.4,
        confidence: 0.95,
        confidence_interval: { lower: 28, upper: 36 },
      };

      nock(FASTAPI_URL)
        .post('/predict/eta', payload)
        .reply(200, fastApiResponse);

      const res = await request(app)
        .post('/api/ml/eta')
        .set('Authorization', authHeader)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('eta_minutes', 32.4);
      expect(res.body).toHaveProperty('confidence', 0.95);
      expect(typeof res.body.eta_minutes).toBe('number');
      expect(typeof res.body.confidence).toBe('number');
    });

    it('when FastAPI returns 422 -> Node returns 400 with error detail', async () => {
      const invalidPayload = { route_distance: -5 };
      const validationErrorDetail = [
        {
          loc: ['body', 'route_distance'],
          msg: 'ensure this value is greater than 0',
          type: 'value_error.number.not_gt',
        },
      ];

      nock(FASTAPI_URL)
        .post('/predict/eta', invalidPayload)
        .reply(422, { detail: validationErrorDetail });

      const res = await request(app)
        .post('/api/ml/eta')
        .set('Authorization', authHeader)
        .send(invalidPayload);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.detail).toEqual(validationErrorDetail);
    });

    it('when FastAPI is unreachable -> Node returns 503 { error: \'ML_SERVICE_UNAVAILABLE\' }', async () => {
      const payload = { route_distance: 10 };

      nock(FASTAPI_URL)
        .post('/predict/eta', payload)
        .replyWithError({
          code: 'ECONNREFUSED',
          message: 'connect ECONNREFUSED 127.0.0.1:8000',
        });

      const res = await request(app)
        .post('/api/ml/eta')
        .set('Authorization', authHeader)
        .send(payload);

      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty('error', 'ML_SERVICE_UNAVAILABLE');
    });

    it('when FastAPI returns unexpected schema -> Node validates and returns 502', async () => {
      const payload = { route_distance: 10 };
      const malformedResponse = { status: 'success', unexpected_field: true };

      nock(FASTAPI_URL)
        .post('/predict/eta', payload)
        .reply(200, malformedResponse);

      const res = await request(app)
        .post('/api/ml/eta')
        .set('Authorization', authHeader)
        .send(payload);

      expect(res.status).toBe(502);
      expect(res.body).toHaveProperty('error', 'ML_INVALID_SCHEMA');
    });
  });

  describe('POST /api/ml/pricing', () => {
    it('response matches OpenAPI schema', async () => {
      const pricingPayload = {
        distance_km: 150.5,
        cargo_weight_kg: 1200,
        truck_type: 'heavy',
      };

      const fastApiPricingResponse = {
        estimated_price: 5400.0,
        min_price: 4900.0,
        max_price: 5900.0,
        currency: 'INR',
      };

      nock(FASTAPI_URL)
        .post('/predict/price', pricingPayload)
        .reply(200, fastApiPricingResponse);

      const res = await request(app)
        .post('/api/ml/pricing')
        .set('Authorization', authHeader)
        .send(pricingPayload);

      expect(res.status).toBe(200);

      // Verify response structure strictly adheres to PricePredictOutput OpenAPI schema
      expect(res.body).toHaveProperty('estimated_price');
      expect(res.body).toHaveProperty('min_price');
      expect(res.body).toHaveProperty('max_price');
      expect(res.body).toHaveProperty('currency');

      expect(typeof res.body.estimated_price).toBe('number');
      expect(typeof res.body.min_price).toBe('number');
      expect(typeof res.body.max_price).toBe('number');
      expect(typeof res.body.currency).toBe('string');
      expect(res.body.currency).toBe('INR');
      expect(res.body.estimated_price).toBe(5400.0);
    });

    it('when FastAPI returns 422 -> returns 400 with detail', async () => {
      nock(FASTAPI_URL)
        .post('/predict/price')
        .reply(422, { detail: 'Missing cargo_weight_kg parameter' });

      const res = await request(app)
        .post('/api/ml/pricing')
        .set('Authorization', authHeader)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('when FastAPI is unreachable -> returns 503 ML_SERVICE_UNAVAILABLE', async () => {
      nock(FASTAPI_URL)
        .post('/predict/price')
        .replyWithError({ code: 'ETIMEDOUT', message: 'connection timed out' });

      const res = await request(app)
        .post('/api/ml/pricing')
        .set('Authorization', authHeader)
        .send({ distance_km: 50 });

      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty('error', 'ML_SERVICE_UNAVAILABLE');
    });
  });

  describe('POST /api/ml/vrp', () => {
    it('with oversized payload -> Node enforces request size limit before forwarding (413)', async () => {
      // Create an oversized payload exceeding 50 stops limit
      const oversizedPayload = {
        stops: Array.from({ length: 65 }, (_, i) => ({
          stop_id: `stop-${i + 1}`,
          lat: 19.076 + i * 0.005,
          lng: 72.877 + i * 0.005,
          demand_kg: 100,
        })),
        truck_capacity_kg: 5000,
      };

      // No nock scope is defined — any outbound HTTP call would throw
      const res = await request(app)
        .post('/api/ml/vrp')
        .set('Authorization', authHeader)
        .send(oversizedPayload);

      expect(res.status).toBe(413);
      expect(res.body).toHaveProperty('error', 'PAYLOAD_TOO_LARGE');
    });

    it('with valid payload -> proxies to FastAPI /optimise/packing', async () => {
      const validVrpPayload = {
        stops: [
          { stop_id: 'stop-1', lat: 19.07, lng: 72.87, demand_kg: 100 },
          { stop_id: 'stop-2', lat: 19.12, lng: 72.85, demand_kg: 150 },
        ],
        truck_capacity_kg: 1000,
      };

      const fastApiVrpResponse = {
        route_sequence: ['stop-1', 'stop-2'],
        total_distance_km: 18.5,
        estimated_duration_minutes: 42,
      };

      nock(FASTAPI_URL)
        .post('/optimise/packing', validVrpPayload)
        .reply(200, fastApiVrpResponse);

      const res = await request(app)
        .post('/api/ml/vrp')
        .set('Authorization', authHeader)
        .send(validVrpPayload);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(fastApiVrpResponse);
    });
  });

  describe('Authentication Enforcement', () => {
    it('all ML routes require valid JWT -> 401 on missing token', async () => {
      const etaRes = await request(app).post('/api/ml/eta').send({ route_distance: 10 });
      expect(etaRes.status).toBe(401);

      const pricingRes = await request(app).post('/api/ml/pricing').send({ distance_km: 100 });
      expect(pricingRes.status).toBe(401);

      const vrpRes = await request(app).post('/api/ml/vrp').send({ stops: [] });
      expect(vrpRes.status).toBe(401);
    });

    it('all ML routes require valid JWT -> 401 on invalid token', async () => {
      const badHeader = 'Bearer invalid.tampered.token';

      const etaRes = await request(app)
        .post('/api/ml/eta')
        .set('Authorization', badHeader)
        .send({ route_distance: 10 });
      expect(etaRes.status).toBe(401);

      const pricingRes = await request(app)
        .post('/api/ml/pricing')
        .set('Authorization', badHeader)
        .send({ distance_km: 100 });
      expect(pricingRes.status).toBe(401);

      const vrpRes = await request(app)
        .post('/api/ml/vrp')
        .set('Authorization', badHeader)
        .send({ stops: [] });
      expect(vrpRes.status).toBe(401);
    });
  });
});
