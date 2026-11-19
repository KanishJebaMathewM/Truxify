import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import axios from 'axios';
import mlPricingRouter from '../../src/routes/mlPricing.js';
import * as priceObfuscationModule from '../../src/services/priceObfuscation.js';

vi.mock('axios');

// Mock strict rate limiter to pass through in unit tests
vi.mock('../../src/middleware/mlRateLimiter.js', () => ({
  strictMlRateLimiter: (req, res, next) => next(),
}));

// Mock logger
vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ML Pricing Routes (mlPricing.js)', () => {
  let app;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.ML_ENGINE_URL = 'http://localhost:8001';
    process.env.ML_API_KEY = 'test-ml-key';

    // Mock price obfuscation to return price * 1.05 for predictable testing
    vi.spyOn(priceObfuscationModule, 'applyPriceObfuscation').mockImplementation(async (price) => {
      return Math.round(price * 1.05);
    });

    app = express();
    app.use(express.json());
    app.use('/api/v1/ml', mlPricingRouter);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('Validation (validateMlRequest)', () => {
    it('should return 400 when origin is missing or too short', async () => {
      const res = await request(app)
        .post('/api/v1/ml/predict-demand')
        .send({ origin: 'NY', destination: 'Boston' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid or missing origin/i);
    });

    it('should return 400 when destination is missing or too short', async () => {
      const res = await request(app)
        .post('/api/v1/ml/predict-demand')
        .send({ origin: 'New York', destination: 'PA' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid or missing destination/i);
    });

    it('should return 400 for non-string origin or destination', async () => {
      const res = await request(app)
        .post('/api/v1/ml/search')
        .send({ origin: 12345, destination: 'Boston' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid or missing origin/i);
    });
  });

  describe('POST /api/v1/ml/predict-demand', () => {
    it('should call ML microservice, apply price obfuscation, and return dynamic pricing', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          demandScore: 0.78,
          estimatedPrice: 20000,
          confidence: 0.89,
        },
      });

      const res = await request(app)
        .post('/api/v1/ml/predict-demand')
        .send({
          origin: 'Mumbai, Maharashtra',
          destination: 'Pune, Maharashtra',
          date: '2026-11-20',
          cargoType: 'General',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:8001/predict_demand',
        {
          origin: 'Mumbai, Maharashtra',
          destination: 'Pune, Maharashtra',
          date: '2026-11-20',
          cargoType: 'General',
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'test-ml-key',
            'Authorization': 'Bearer test-ml-key',
          }),
        })
      );

      // Price obfuscation was price * 1.05: 20000 * 1.05 = 21000
      expect(res.body.data.estimatedPrice).toBe(21000);
      expect(res.body.data.demandScore).toBe(0.78);
      expect(res.body.data.confidence).toBe(0.89);
    });

    it('should fall back to /predict/demand if /predict_demand returns 404', async () => {
      const notFoundErr = new Error('Not Found');
      notFoundErr.response = { status: 404 };
      axios.post
        .mockRejectedValueOnce(notFoundErr)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            predicted_demand: 0.82,
            estimated_price: 18000,
            confidence_score: 0.95,
          },
        });

      const res = await request(app)
        .post('/api/v1/ml/predict-demand')
        .send({
          origin: 'Delhi, India',
          destination: 'Jaipur, Rajasthan',
        });

      expect(res.status).toBe(200);
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenNthCalledWith(1, 'http://localhost:8001/predict_demand', expect.any(Object), expect.any(Object));
      expect(axios.post).toHaveBeenNthCalledWith(2, 'http://localhost:8001/predict/demand', expect.any(Object), expect.any(Object));
      expect(res.body.data.demandScore).toBe(0.82);
      expect(res.body.data.estimatedPrice).toBe(18900); // 18000 * 1.05
    });

    it('should return 500 when ML service fails in production', async () => {
      process.env.NODE_ENV = 'production';
      axios.post.mockRejectedValue(new Error('ML connection refused'));

      const res = await request(app)
        .post('/api/v1/ml/predict-demand')
        .send({
          origin: 'Mumbai, Maharashtra',
          destination: 'Pune, Maharashtra',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Internal server error/i);
    });

    it('should fall back to mock data when ML service fails in non-production', async () => {
      process.env.NODE_ENV = 'development';
      axios.post.mockRejectedValue(new Error('ML service offline in local dev'));

      const res = await request(app)
        .post('/api/v1/ml/predict-demand')
        .send({
          origin: 'Mumbai, Maharashtra',
          destination: 'Pune, Maharashtra',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.demandScore).toBe(0.85);
      expect(res.body.data.estimatedPrice).toBe(15750); // 15000 * 1.05
    });
  });

  describe('POST /api/v1/ml/search', () => {
    it('should call ML microservice, obfuscate each load price, and return dynamic results', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          results: [
            { id: 'load-101', price: 16000, distance: 500 },
            { id: 'load-102', price: 22000, distance: 520 },
          ],
        },
      });

      const res = await request(app)
        .post('/api/v1/ml/search')
        .send({
          origin: 'Chennai, Tamil Nadu',
          destination: 'Bengaluru, Karnataka',
          vehicleType: 'Heavy Truck',
          maxPrice: 30000,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:8001/search_loads',
        {
          origin: 'Chennai, Tamil Nadu',
          destination: 'Bengaluru, Karnataka',
          vehicleType: 'Heavy Truck',
          maxPrice: 30000,
        },
        expect.any(Object)
      );

      // Obfuscated prices (price * 1.05):
      // 16000 * 1.05 = 16800, 22000 * 1.05 = 23100
      expect(res.body.data.results).toEqual([
        { id: 'load-101', price: 16800, distance: 500 },
        { id: 'load-102', price: 23100, distance: 520 },
      ]);
    });

    it('should fall back to /search if /search_loads returns 404', async () => {
      const notFoundErr = new Error('Not Found');
      notFoundErr.response = { status: 404 };
      axios.post
        .mockRejectedValueOnce(notFoundErr)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            results: [
              { id: 'load-201', price: 10000, distance: 300 },
            ],
          },
        });

      const res = await request(app)
        .post('/api/v1/ml/search')
        .send({
          origin: 'Ahmedabad, Gujarat',
          destination: 'Surat, Gujarat',
        });

      expect(res.status).toBe(200);
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenNthCalledWith(1, 'http://localhost:8001/search_loads', expect.any(Object), expect.any(Object));
      expect(axios.post).toHaveBeenNthCalledWith(2, 'http://localhost:8001/search', expect.any(Object), expect.any(Object));
      expect(res.body.data.results[0].price).toBe(10500); // 10000 * 1.05
    });

    it('should return 500 when ML service fails in production', async () => {
      process.env.NODE_ENV = 'production';
      axios.post.mockRejectedValue(new Error('ML search failed'));

      const res = await request(app)
        .post('/api/v1/ml/search')
        .send({
          origin: 'Chennai, Tamil Nadu',
          destination: 'Bengaluru, Karnataka',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Internal server error/i);
    });

    it('should fall back to mock results when ML service fails in non-production', async () => {
      process.env.NODE_ENV = 'development';
      axios.post.mockRejectedValue(new Error('ML search offline'));

      const res = await request(app)
        .post('/api/v1/ml/search')
        .send({
          origin: 'Chennai, Tamil Nadu',
          destination: 'Bengaluru, Karnataka',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.results).toHaveLength(2);
      // Mock items (12000 * 1.05 = 12600, 13500 * 1.05 = 14175)
      expect(res.body.data.results[0].price).toBe(12600);
      expect(res.body.data.results[1].price).toBe(14175);
    });
  });
});
