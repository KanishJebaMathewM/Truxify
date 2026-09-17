import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mlService, {
  predictDemand,
  predictPrice,
  predictEta,
  predictCancellationPenalty,
  predictDriverProfit,
  matchDeadhead,
  matchEnRouteLoads,
  getAbTestingStatus,
  rollbackAbTest,
  __testing,
} from '../../src/services/ml.js';

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

const {
  demandCache,
  priceCache,
  _haversineKm,
  parseWeightKg,
  parseWeightKgSafe,
  parseDimensions,
  getHeaders,
  handleResponse,
  getBaseUrl,
  guardMlApiKey,
} = __testing;

describe('services/ml.js Unit Tests', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    demandCache.clear();
    priceCache.clear();
    process.env.ML_API_KEY = 'test-ml-key';
    process.env.ML_ENGINE_URL = 'http://ml.test:8001';
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe('Default export', () => {
    it('exports all expected service methods', () => {
      expect(typeof mlService.predictDemand).toBe('function');
      expect(typeof mlService.predictPrice).toBe('function');
      expect(typeof mlService.predictEta).toBe('function');
      expect(typeof mlService.predictCancellationPenalty).toBe('function');
      expect(typeof mlService.predictDriverProfit).toBe('function');
      expect(typeof mlService.matchDeadhead).toBe('function');
      expect(typeof mlService.matchEnRouteLoads).toBe('function');
      expect(typeof mlService.getAbTestingStatus).toBe('function');
      expect(typeof mlService.rollbackAbTest).toBe('function');
      expect(typeof mlService.handleResponse).toBe('function');
    });
  });

  describe('guardMlApiKey', () => {
    it('throws 503 error when ML_API_KEY is not set', () => {
      delete process.env.ML_API_KEY;
      expect(() => guardMlApiKey()).toThrow(/ML_API_KEY is not configured/);
    });

    it('does not throw when ML_API_KEY is set', () => {
      process.env.ML_API_KEY = 'valid-key';
      expect(() => guardMlApiKey()).not.toThrow();
    });
  });

  describe('getBaseUrl', () => {
    it('returns ML_ENGINE_URL when configured', () => {
      process.env.ML_ENGINE_URL = 'http://engine.example.com';
      process.env.ML_SERVICE_URL = 'http://service.example.com';
      expect(getBaseUrl()).toBe('http://engine.example.com');
    });

    it('falls back to ML_SERVICE_URL when ML_ENGINE_URL is missing', () => {
      delete process.env.ML_ENGINE_URL;
      process.env.ML_SERVICE_URL = 'http://service.example.com';
      expect(getBaseUrl()).toBe('http://service.example.com');
    });

    it('falls back to default localhost:8001 when neither is set', () => {
      delete process.env.ML_ENGINE_URL;
      delete process.env.ML_SERVICE_URL;
      expect(getBaseUrl()).toBe('http://localhost:8001');
    });
  });

  describe('getHeaders', () => {
    it('includes Content-Type and X-API-Key when ML_API_KEY is set', () => {
      process.env.ML_API_KEY = 'my-secret-key';
      const headers = getHeaders();
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        'X-API-Key': 'my-secret-key',
      });
    });

    it('includes only Content-Type when ML_API_KEY is unset', () => {
      delete process.env.ML_API_KEY;
      const headers = getHeaders();
      expect(headers).toEqual({
        'Content-Type': 'application/json',
      });
    });
  });

  describe('handleResponse', () => {
    it('parses and returns JSON for successful response', async () => {
      const mockRes = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, count: 42 }),
      };
      const result = await handleResponse(mockRes, 'http://test/api', 'GET');
      expect(result).toEqual({ success: true, count: 42 });
    });

    it('throws authentication error for 401 status', async () => {
      const mockRes = {
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      };
      await expect(handleResponse(mockRes, 'http://test/auth', 'POST')).rejects.toThrow(
        /Authentication failed \(401\): POST http:\/\/test\/auth - Unauthorized/
      );
    });

    it('throws authentication error for 403 status', async () => {
      const mockRes = {
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      };
      await expect(handleResponse(mockRes, 'http://test/auth', 'POST')).rejects.toThrow(
        /Authentication failed \(403\): POST http:\/\/test\/auth - Forbidden/
      );
    });

    it('throws request failed error for other non-ok status codes', async () => {
      const mockRes = {
        ok: false,
        status: 500,
        text: async () => 'Server Error',
      };
      await expect(handleResponse(mockRes, 'http://test/fail', 'GET')).rejects.toThrow(
        /\[ML\] Request failed: GET http:\/\/test\/fail 500 - Server Error/
      );
    });

    it('throws invalid JSON error when body cannot be parsed', async () => {
      const mockRes = {
        ok: true,
        status: 200,
        text: async () => 'not a json <xml>',
      };
      await expect(handleResponse(mockRes, 'http://test/invalid', 'POST')).rejects.toThrow(
        /Invalid JSON response from ML engine/
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('parseWeightKg and parseWeightKgSafe', () => {
    it('handles numeric inputs directly', () => {
      expect(parseWeightKg(500)).toBe(500);
      expect(parseWeightKg('500')).toBe(500);
    });

    it('parses kg and ton/tonne units correctly', () => {
      expect(parseWeightKg('250 kg')).toBe(250);
      expect(parseWeightKg('2.5 ton')).toBe(2500);
      expect(parseWeightKg('3 tonne')).toBe(3000);
      expect(parseWeightKg('1.2 t')).toBe(1200);
    });

    it('returns null for invalid weight strings', () => {
      expect(parseWeightKg('heavy load')).toBeNull();
      expect(parseWeightKg(null)).toBeNull();
    });

    it('parseWeightKgSafe returns parsed number or null on invalid', () => {
      expect(parseWeightKgSafe('500 kg')).toBe(500);
      expect(parseWeightKgSafe(null)).toBeNull();
      expect(parseWeightKgSafe('')).toBeNull();
      expect(parseWeightKgSafe('unparseable')).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('parseDimensions', () => {
    it('returns fallback { length: 1, width: 1, height: 1 } for invalid or missing inputs', () => {
      expect(parseDimensions(null)).toEqual({ length: 1, width: 1, height: 1 });
      expect(parseDimensions('10 X 5')).toEqual({ length: 1, width: 1, height: 1 });
    });

    it('converts feet to meters when "ft" is present', () => {
      const parsed = parseDimensions('10 X 5 X 4 ft');
      expect(parsed.length).toBeCloseTo(3.05, 2);
      expect(parsed.width).toBeCloseTo(1.52, 2);
      expect(parsed.height).toBeCloseTo(1.22, 2);
    });

    it('keeps meters as-is when "ft" is not present', () => {
      const parsed = parseDimensions('10 X 5 X 4 m');
      expect(parsed).toEqual({ length: 10, width: 5, height: 4 });
    });
  });

  describe('_haversineKm', () => {
    it('returns 0 for identical coordinates', () => {
      expect(_haversineKm(28.6139, 77.209, 28.6139, 77.209)).toBe(0);
    });

    it('computes distance between Delhi and Mumbai (~1150 km)', () => {
      const distance = _haversineKm(28.6139, 77.209, 19.076, 72.8777);
      expect(distance).toBeGreaterThan(1100);
      expect(distance).toBeLessThan(1250);
    });
  });

  describe('predictDemand', () => {
    it('throws if ML_API_KEY is not set', async () => {
      delete process.env.ML_API_KEY;
      await expect(predictDemand({ lat: 28.6, lng: 77.2 })).rejects.toThrow(/ML_API_KEY is not configured/);
    });

    it('fetches demand prediction and caches the result', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ demand_score: 0.85, hotspot: 'delhi-ncr' }),
      });

      const features = { lat: 28.6, lng: 77.2, time_bucket: 14 };
      const res1 = await predictDemand(features);
      expect(res1).toEqual({ demand_score: 0.85, hotspot: 'delhi-ncr' });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Second call should hit demandCache
      const res2 = await predictDemand(features);
      expect(res2).toEqual({ demand_score: 0.85, hotspot: 'delhi-ncr' });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('predictPrice', () => {
    it('throws if ML_API_KEY is not set', async () => {
      delete process.env.ML_API_KEY;
      await expect(predictPrice({ distanceKm: 50, cargoWeightKg: 1000 })).rejects.toThrow(/ML_API_KEY is not configured/);
    });

    it('successfully predicts price with surge adjustment, paisa conversion, and caching', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 2500,
            min_price: 2000,
            max_price: 3000,
            currency: 'INR',
            confidence: 0.9,
          }),
      });

      const params = {
        distanceKm: 50,
        cargoWeightKg: 1500,
        truckType: 'heavy_truck',
        routeOrigin: 'Delhi',
        routeDestination: 'Jaipur',
        trafficMultiplier: 1.2,
      };

      const result = await predictPrice(params);
      // Adjusted price: 2500 * 1.2 = 3000 INR
      expect(result.estimated_price).toBe(3000);
      expect(result.estimatedPriceInr).toBe(3000);
      expect(result.estimatedPricePaisa).toBe(300000);
      expect(result.min_price).toBe(2400); // 2000 * 1.2
      expect(result.max_price).toBe(3600); // 3000 * 1.2
      expect(result.currency).toBe('INR');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Subsequent identical call should hit priceCache
      const cachedResult = await predictPrice(params);
      expect(cachedResult).toEqual(result);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('clamps trafficMultiplier between 0.5 and 3.0', async () => {
      globalThis.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 1000,
            currency: 'INR',
          }),
      });

      // Extreme low: 0.1 -> clamped to 0.5 -> 1000 * 0.5 = 500
      const lowResult = await predictPrice({
        distanceKm: 20,
        cargoWeightKg: 500,
        trafficMultiplier: 0.1,
      });
      expect(lowResult.estimated_price).toBe(500);

      // Extreme high: 5.0 -> clamped to 3.0 -> 1000 * 3.0 = 3000
      const highResult = await predictPrice({
        distanceKm: 20,
        cargoWeightKg: 500,
        trafficMultiplier: 5.0,
      });
      expect(highResult.estimated_price).toBe(3000);

      // Invalid multiplier (negative or NaN) -> defaults to 1.0 -> 1000 * 1.0 = 1000
      const invalidResult = await predictPrice({
        distanceKm: 20,
        cargoWeightKg: 500,
        trafficMultiplier: -2,
      });
      expect(invalidResult.estimated_price).toBe(1000);
    });

    it('throws error when ML response fails initial validation', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: -50, // Negative price is invalid
            currency: 'INR',
          }),
      });

      await expect(
        predictPrice({ distanceKm: 10, cargoWeightKg: 200 })
      ).rejects.toThrow(/\[ML\] Invalid prediction/);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('throws error when surge-adjusted price exceeds maximum validation limits', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 300000, // Safe initially, but with 2.5 multiplier = 750,000 (> 500,000 ceiling)
            currency: 'INR',
          }),
      });

      await expect(
        predictPrice({ distanceKm: 1000, cargoWeightKg: 20000, trafficMultiplier: 2.5 })
      ).rejects.toThrow(/Surge-adjusted price prediction rejected by validator|Invalid prediction/);
    });

    // Regression tests for GitHub issue #13490
    // Verify min_price/max_price are only included when valid finite numbers
    it('omits min_price from returned object when raw response has undefined min_price', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 1500,
            max_price: 2000,
            currency: 'INR',
          }),
      });

      const result = await predictPrice({ distanceKm: 30, cargoWeightKg: 500 });
      expect(result.estimated_price).toBe(1500);
      // min_price should be computed from default band (15% below) since raw had no min_price
      expect(result.min_price).toBe(1275); // 1500 * 0.85
      expect(result.max_price).toBe(2000);
    });

    it('omits max_price from returned object when raw response has undefined max_price', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 1500,
            min_price: 1200,
            currency: 'INR',
          }),
      });

      const result = await predictPrice({ distanceKm: 30, cargoWeightKg: 500 });
      expect(result.estimated_price).toBe(1500);
      expect(result.min_price).toBe(1200);
      // max_price should be computed from default band (15% above) since raw had no max_price
      expect(result.max_price).toBe(1725); // 1500 * 1.15
    });

    it('omits non-finite min_price (NaN, Infinity, -Infinity) from returned object', async () => {
      // Test NaN
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 1500,
            min_price: NaN,
            max_price: 2000,
            currency: 'INR',
          }),
      });

      const resultNaN = await predictPrice({ distanceKm: 30, cargoWeightKg: 500 });
      expect(resultNaN.estimated_price).toBe(1500);
      // min_price should fall back to default band since NaN is not finite
      expect(resultNaN.min_price).toBe(1275); // 1500 * 0.85
      expect(resultNaN.max_price).toBe(2000);

      // Test Infinity
      priceCache.clear();
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 1500,
            min_price: Infinity,
            max_price: 2000,
            currency: 'INR',
          }),
      });

      const resultInf = await predictPrice({ distanceKm: 30, cargoWeightKg: 500 });
      expect(resultInf.min_price).toBe(1275); // falls back to default

      // Test -Infinity
      priceCache.clear();
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 1500,
            min_price: -Infinity,
            max_price: 2000,
            currency: 'INR',
          }),
      });

      const resultNegInf = await predictPrice({ distanceKm: 30, cargoWeightKg: 500 });
      expect(resultNegInf.min_price).toBe(1275); // falls back to default
    });

    it('omits non-finite max_price (NaN, Infinity, -Infinity) from returned object', async () => {
      // Test NaN
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 1500,
            min_price: 1200,
            max_price: NaN,
            currency: 'INR',
          }),
      });

      const resultNaN = await predictPrice({ distanceKm: 30, cargoWeightKg: 500 });
      expect(resultNaN.estimated_price).toBe(1500);
      expect(resultNaN.min_price).toBe(1200);
      // max_price should fall back to default band since NaN is not finite
      expect(resultNaN.max_price).toBe(1725); // 1500 * 1.15

      // Test Infinity
      priceCache.clear();
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 1500,
            min_price: 1200,
            max_price: Infinity,
            currency: 'INR',
          }),
      });

      const resultInf = await predictPrice({ distanceKm: 30, cargoWeightKg: 500 });
      expect(resultInf.max_price).toBe(1725); // falls back to default

      // Test -Infinity
      priceCache.clear();
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 1500,
            min_price: 1200,
            max_price: -Infinity,
            currency: 'INR',
          }),
      });

      const resultNegInf = await predictPrice({ distanceKm: 30, cargoWeightKg: 500 });
      expect(resultNegInf.max_price).toBe(1725); // falls back to default
    });

    it('retains valid finite min_price and max_price in returned object', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            estimated_price: 2500,
            min_price: 2000,
            max_price: 3000,
            currency: 'INR',
            confidence: 0.9,
          }),
      });

      const result = await predictPrice({
        distanceKm: 50,
        cargoWeightKg: 1500,
        trafficMultiplier: 1.2,
      });

      // Adjusted price: 2500 * 1.2 = 3000 INR
      expect(result.estimated_price).toBe(3000);
      expect(result.min_price).toBe(2400); // 2000 * 1.2
      expect(result.max_price).toBe(3600); // 3000 * 1.2
    });
  });

  describe('predictEta', () => {
    it('throws if ML_API_KEY is not set', async () => {
      delete process.env.ML_API_KEY;
      await expect(
        predictEta({
          routeDistance: 120,
          timeOfDay: 14,
          dayOfWeek: 2,
          routeType: 'highway',
          historicalSpeed: 60,
        })
      ).rejects.toThrow(/ML_API_KEY is not configured/);
    });

    it('returns predicted ETA and confidence interval', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            eta_minutes: 135.5,
            confidence_interval: { lower: 120, upper: 150 },
          }),
      });

      const res = await predictEta({
        routeDistance: 120,
        timeOfDay: 14,
        dayOfWeek: 2,
        routeType: 'highway',
        historicalSpeed: 60,
      });

      expect(res).toEqual({
        eta_minutes: 135.5,
        confidence_interval: { lower: 120, upper: 150 },
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://ml.test:8001/predict/eta',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            route_distance: 120,
            time_of_day: 14,
            day_of_week: 2,
            route_type: 'highway',
            historical_speed: 60,
          }),
        })
      );
    });

    it('throws when eta_minutes is missing or non-finite', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ eta_minutes: 'not-a-number' }),
      });

      await expect(
        predictEta({
          routeDistance: 120,
          timeOfDay: 14,
          dayOfWeek: 2,
          routeType: 'highway',
          historicalSpeed: 60,
        })
      ).rejects.toThrow(/Invalid ETA prediction/);
    });

    it('defaults confidence_interval when not provided in response', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ eta_minutes: 90 }),
      });

      const res = await predictEta({
        routeDistance: 80,
        timeOfDay: 10,
        dayOfWeek: 1,
        routeType: 'city',
        historicalSpeed: 40,
      });

      expect(res).toEqual({
        eta_minutes: 90,
        confidence_interval: { lower: 0, upper: 0 },
      });
    });
  });

  describe('predictCancellationPenalty', () => {
    it('throws if ML_API_KEY is not set', async () => {
      delete process.env.ML_API_KEY;
      await expect(
        predictCancellationPenalty({
          distanceCoveredKm: 10,
          totalDistanceKm: 100,
          totalAmount: 1000,
        })
      ).rejects.toThrow(/ML_API_KEY is not configured/);
    });

    it('rejects invalid numerical parameters', async () => {
      await expect(
        predictCancellationPenalty({ distanceCoveredKm: -5, totalDistanceKm: 100, totalAmount: 1000 })
      ).rejects.toThrow(/distanceCoveredKm must be a finite non-negative number/);

      await expect(
        predictCancellationPenalty({ distanceCoveredKm: 10, totalDistanceKm: 0, totalAmount: 1000 })
      ).rejects.toThrow(/totalDistanceKm must be a finite positive number/);

      await expect(
        predictCancellationPenalty({ distanceCoveredKm: 10, totalDistanceKm: 100, totalAmount: -100 })
      ).rejects.toThrow(/totalAmount must be a finite non-negative number/);
    });

    it('returns penalty amount and covered ratio on valid response', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            penalty_amount: 250,
            covered_ratio: 0.25,
          }),
      });

      const res = await predictCancellationPenalty({
        distanceCoveredKm: 25,
        totalDistanceKm: 100,
        totalAmount: 1000,
      });

      expect(res).toEqual({ penalty_amount: 250, covered_ratio: 0.25 });
    });

    it('rejects responses with penalty greater than total amount or invalid ratio', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            penalty_amount: 1500, // greater than totalAmount 1000
            covered_ratio: 0.25,
          }),
      });

      await expect(
        predictCancellationPenalty({
          distanceCoveredKm: 25,
          totalDistanceKm: 100,
          totalAmount: 1000,
        })
      ).rejects.toThrow(/Invalid cancellation penalty response/);
    });
  });

  describe('predictDriverProfit', () => {
    it('throws if ML_API_KEY is not set', async () => {
      delete process.env.ML_API_KEY;
      await expect(
        predictDriverProfit({
          routeDistanceKm: 100,
          fuelPricePerLitre: 95,
          tollEstimateInr: 200,
          truckMileageKmL: 4,
          cargoWeightKg: 5000,
          tripDurationHours: 3,
        })
      ).rejects.toThrow(/ML_API_KEY is not configured/);
    });

    it('formats payload, rounds profit and confidence bounds', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            predicted_profit: 4520.556,
            confidence_interval: { lower: 3800.123, upper: 5200.789 },
          }),
      });

      const res = await predictDriverProfit({
        routeDistanceKm: 150,
        fuelPricePerLitre: 96,
        tollEstimateInr: 300,
        truckMileageKmL: 4.5,
        cargoWeightKg: 6000,
        tripDurationHours: 4,
      });

      expect(res).toEqual({
        predicted_profit: 4520.56,
        confidence_interval: { lower: 3800.12, upper: 5200.79 },
        currency: 'INR',
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://ml.test:8001/predict/driver-profit',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            route_distance: 150,
            fuel_price: 96,
            toll_estimate: 300,
            truck_mileage: 4.5,
            cargo_weight: 6000,
            trip_duration: 4,
          }),
        })
      );
    });

    it('throws when predicted_profit is missing or non-finite', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ confidence_interval: { lower: 100, upper: 200 } }),
      });

      await expect(
        predictDriverProfit({
          routeDistanceKm: 100,
          fuelPricePerLitre: 95,
          tollEstimateInr: 200,
          truckMileageKmL: 4,
          cargoWeightKg: 5000,
          tripDurationHours: 3,
        })
      ).rejects.toThrow(/Invalid driver profit prediction: missing or non-finite predicted_profit/);
    });

    it('throws when confidence_interval is missing', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ predicted_profit: 3000 }),
      });

      await expect(
        predictDriverProfit({
          routeDistanceKm: 100,
          fuelPricePerLitre: 95,
          tollEstimateInr: 200,
          truckMileageKmL: 4,
          cargoWeightKg: 5000,
          tripDurationHours: 3,
        })
      ).rejects.toThrow(/Invalid driver profit prediction: missing confidence_interval/);
    });
  });

  describe('matchDeadhead', () => {
    it('posts deadhead matching payload and returns result', async () => {
      const mockResult = { recommendations: [{ load_id: 'load-1', score: 0.95 }] };
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResult),
      });

      const res = await matchDeadhead({
        driverDestination: { lat: 12.97, lng: 77.59 },
        truckSpecs: { max_weight_kg: 10000 },
        arrivalTime: '2026-09-16T10:00:00.000Z',
        availableLoads: [{ id: 'load-1' }],
      });

      expect(res).toEqual(mockResult);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://ml.test:8001/match/deadhead',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            driver_destination: { lat: 12.97, lng: 77.59 },
            truck_specs: { max_weight_kg: 10000 },
            arrival_time: '2026-09-16T10:00:00.000Z',
            available_loads: [{ id: 'load-1' }],
          }),
        })
      );
    });
  });

  describe('matchEnRouteLoads', () => {
    it('returns empty array when offers list is empty or undefined', async () => {
      expect(await matchEnRouteLoads({ currentLat: 12.97, currentLng: 77.59, offers: [] })).toEqual([]);
      expect(await matchEnRouteLoads({ currentLat: 12.97, currentLng: 77.59, offers: null })).toEqual([]);
    });

    it('enriches offers with ML engine recommendations when available', async () => {
      const offers = [
        {
          id: 'offer-1',
          pickup_lat: 12.97,
          pickup_lng: 77.59,
          drop_lat: 13.08,
          drop_lng: 80.27,
          weight: '3 tonnes',
          dimensions: '10 X 5 X 4 ft',
          payment_inr: 5000,
        },
      ];

      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            recommendations: [
              {
                load_id: 'offer-1',
                detour_km: 8.5,
                match_score: 0.92,
                estimated_earnings: 5200,
              },
            ],
          }),
      });

      const res = await matchEnRouteLoads({
        currentLat: 12.95,
        currentLng: 77.58,
        offers,
      });

      expect(res.length).toBe(1);
      expect(res[0].id).toBe('offer-1');
      expect(res[0].detour_km).toBe(8.5);
      expect(res[0].extra_earnings).toBe(520000); // 5200 INR converted to paisa
      expect(res[0].match_score).toBe(0.92);
      expect(res[0].ml_used).toBe(true);
    });

    it('falls back to haversine distance ranking when ML engine call fails', async () => {
      const offers = [
        {
          id: 'offer-near',
          pickup_lat: 12.98,
          pickup_lng: 77.60,
          drop_lat: 13.08,
          drop_lng: 80.27,
          weight: '2 ton',
          freight_value: 200000,
        },
        {
          id: 'offer-far',
          pickup_lat: 15.0,
          pickup_lng: 78.0,
          drop_lat: 16.0,
          drop_lng: 79.0,
          weight: '2 ton',
          freight_value: 300000,
        },
      ];

      // ML engine fails
      globalThis.fetch.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await matchEnRouteLoads({
        currentLat: 12.97,
        currentLng: 77.59,
        offers,
        maxDetourKm: 50,
      });

      // Only offer-near is within 50km detour
      expect(res.length).toBe(1);
      expect(res[0].id).toBe('offer-near');
      expect(res[0].ml_used).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('falling back to haversine'));
    });
  });

  describe('getAbTestingStatus', () => {
    it('throws if ML_API_KEY is not set', async () => {
      delete process.env.ML_API_KEY;
      await expect(getAbTestingStatus()).rejects.toThrow(/ML_API_KEY is not configured/);
    });

    it('calls GET /ab-testing/status and returns response', async () => {
      const mockStatus = { active_tests: [{ id: 'test-1', model: 'v2' }] };
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockStatus),
      });

      const res = await getAbTestingStatus();
      expect(res).toEqual(mockStatus);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://ml.test:8001/ab-testing/status',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('rollbackAbTest', () => {
    it('throws if ML_API_KEY is not set', async () => {
      delete process.env.ML_API_KEY;
      await expect(rollbackAbTest('exp-123')).rejects.toThrow(/ML_API_KEY is not configured/);
    });

    it('validates testId parameter', async () => {
      await expect(rollbackAbTest('')).rejects.toThrow(/Valid testId is required for rollback/);
      await expect(rollbackAbTest(null)).rejects.toThrow(/Valid testId is required for rollback/);
    });

    it('invokes POST /ab-testing/rollback/:testId', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ rolled_back: true, test_id: 'exp-123' }),
      });

      const res = await rollbackAbTest('exp-123');
      expect(res).toEqual({ rolled_back: true, test_id: 'exp-123' });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://ml.test:8001/ab-testing/rollback/exp-123',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
