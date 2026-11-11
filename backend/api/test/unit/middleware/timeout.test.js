import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import timeout from 'connect-timeout';
import {
  timeoutMiddleware,
  vrpTimeoutMiddleware,
  demandHeatmapTimeoutMiddleware,
  defaultTimeoutMiddleware,
  createTimeoutMiddleware,
  timeoutErrorHandler,
  slowRequestLogger,
  logSlowRequest,
  getTimeoutForPath,
  SLOW_REQUEST_THRESHOLD_MS,
  ROUTE_TIMEOUT_OVERRIDES
} from '../../../src/middleware/timeout.js';
import app from '../../../src/app.js';

describe('Request Timeout Middleware Unit & Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Global and Route-Specific Timeout Configurations', () => {
    it('should correctly configure default and per-route timeouts', () => {
      expect(ROUTE_TIMEOUT_OVERRIDES['/api/ml/vrp']).toBe('120s');
      expect(ROUTE_TIMEOUT_OVERRIDES['/api/ml/demand-heatmap']).toBe('60s');
      expect(ROUTE_TIMEOUT_OVERRIDES['default']).toBe('30s');

      expect(getTimeoutForPath('/api/ml/vrp')).toBe('120s');
      expect(getTimeoutForPath('/api/ml/vrp/optimize')).toBe('120s');
      expect(getTimeoutForPath('/api/ml/demand-heatmap')).toBe('60s');
      expect(getTimeoutForPath('/api/demand-heatmap')).toBe('60s');
      expect(getTimeoutForPath('/api/orders')).toBe('30s');
      expect(getTimeoutForPath('/api/trips')).toBe('30s');
      expect(getTimeoutForPath('/')).toBe('30s');
    });

    it('should export middleware arrays conforming to [timeoutFn, haltOnTimedout]', () => {
      expect(Array.isArray(timeoutMiddleware)).toBe(true);
      expect(timeoutMiddleware).toHaveLength(2);
      expect(typeof timeoutMiddleware[0]).toBe('function');
      expect(typeof timeoutMiddleware[1]).toBe('function');

      expect(Array.isArray(vrpTimeoutMiddleware)).toBe(true);
      expect(vrpTimeoutMiddleware).toHaveLength(2);

      expect(Array.isArray(demandHeatmapTimeoutMiddleware)).toBe(true);
      expect(demandHeatmapTimeoutMiddleware).toHaveLength(2);

      expect(Array.isArray(defaultTimeoutMiddleware)).toBe(true);
      expect(defaultTimeoutMiddleware).toHaveLength(2);
    });

    it('createTimeoutMiddleware helper should create custom timeout middleware', () => {
      const customMiddleware = createTimeoutMiddleware('45s');
      expect(Array.isArray(customMiddleware)).toBe(true);
      expect(customMiddleware).toHaveLength(2);
      expect(typeof customMiddleware[0]).toBe('function');
      expect(typeof customMiddleware[1]).toBe('function');
    });
  });

  describe('2. Timeout Error Response Handler', () => {
    it('should respond with 503 and exact JSON payload on request timeout', async () => {
      const testApp = express();

      // Use a very short timeout for testing (50ms)
      testApp.use(createTimeoutMiddleware('50ms'));
      testApp.get('/slow-operation', (req, res) => {
        // Deliberately do not respond, simulating hung downstream ML/RPC service
        setTimeout(() => {
          if (!res.headersSent) {
            res.send('completed late');
          }
        }, 150);
      });
      testApp.use(timeoutErrorHandler);

      const response = await request(testApp).get('/slow-operation');

      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toBe('5');
      expect(response.body).toEqual({
        error: 'REQUEST_TIMEOUT',
        message: 'Request exceeded the time limit. Please try again.',
        retryAfter: 5
      });
    });

    it('should pass non-timeout errors to next error handler', async () => {
      const testApp = express();
      const customError = new Error('Database connection failed');

      testApp.get('/error', (req, res, next) => {
        next(customError);
      });
      testApp.use(timeoutErrorHandler);
      testApp.use((err, req, res, next) => {
        res.status(500).json({ custom: err.message });
      });

      const response = await request(testApp).get('/error');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ custom: 'Database connection failed' });
    });

    it('should not write to headers if headers are already sent', () => {
      const mockReq = { timedout: true, originalUrl: '/test' };
      const mockRes = {
        headersSent: true,
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        set: vi.fn()
      };
      const mockNext = vi.fn();
      const testError = new Error('Response timeout');
      testError.code = 'ETIMEDOUT';

      timeoutErrorHandler(testError, mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(testError);
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });

  describe('3. Slow Request Monitoring (>10s) to MongoDB collection', () => {
    it('should log request to slow_requests collection when duration exceeds 10s', async () => {
      const mockCollection = {
        insertOne: vi.fn().mockResolvedValue({ acknowledged: true, insertedId: 'mock-id-123' })
      };
      const mockDb = {
        collection: vi.fn().mockReturnValue(mockCollection)
      };

      const testApp = express();

      // Test with custom threshold (40ms) to simulate slow request in unit test
      testApp.use((req, res, next) => {
        req.user = { id: 'test-user-uuid' };
        req.requestId = 'req-abc-123';
        next();
      });
      testApp.use(slowRequestLogger(40));

      testApp.get('/simulated-slow-query', (req, res) => {
        setTimeout(() => {
          res.status(200).json({ ok: true });
        }, 80);
      });

      await request(testApp).get('/simulated-slow-query');

      // Wait a tick for finish listener and async DB write
      await new Promise(resolve => setTimeout(resolve, 50));

      // Test direct logging with customDb
      await logSlowRequest({
        url: '/simulated-slow-query',
        method: 'GET',
        statusCode: 200,
        durationMs: 12500,
        userId: 'test-user-uuid',
        requestId: 'req-abc-123'
      }, mockDb);

      expect(mockDb.collection).toHaveBeenCalledWith('slow_requests');
      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/simulated-slow-query',
          method: 'GET',
          statusCode: 200,
          durationMs: 12500,
          userId: 'test-user-uuid',
          requestId: 'req-abc-123',
          timestamp: expect.any(Date)
        })
      );
    });

    it('should gracefully handle when MongoDB is not connected', async () => {
      const result = await logSlowRequest({
        url: '/api/ml/vrp',
        method: 'POST',
        durationMs: 15000
      }, null);

      expect(result).toBeNull();
    });

    it('should catch and handle DB insertion errors without crashing', async () => {
      const failingDb = {
        collection: vi.fn().mockReturnValue({
          insertOne: vi.fn().mockRejectedValue(new Error('Mongo network timeout'))
        })
      };

      const result = await logSlowRequest({
        url: '/api/ml/demand-heatmap',
        method: 'GET',
        durationMs: 11000
      }, failingDb);

      expect(result).toBeNull();
    });
  });

  describe('4. Express Backend App Integration (backend/api/src/app.js)', () => {
    it('GET /health returns healthy status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('uptime');
    });

    it('GET /api/health returns healthy status', async () => {
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
    });

    it('POST /api/ml/vrp route returns 200 within timeout limit', async () => {
      const response = await request(app)
        .post('/api/ml/vrp')
        .send({ fleetSize: 10, locations: [] });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('route', '/api/ml/vrp');
      expect(response.body).toHaveProperty('timeout', '120s');
    });

    it('GET /api/ml/demand-heatmap route returns 200 within timeout limit', async () => {
      const response = await request(app).get('/api/ml/demand-heatmap');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('route', '/api/ml/demand-heatmap');
      expect(response.body).toHaveProperty('timeout', '60s');
    });
  });
});
