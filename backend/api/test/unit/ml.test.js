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
// backend/api/test/unit/ml.test.js

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  parseWeightKg, 
  parseDimensions, 
  guardMlApiKey 
} from '../../src/services/ml.js';

describe('ML Service Helpers', () => {
  describe('parseWeightKg', () => {
    it('should correctly parse weight strings in kilograms', () => {
      expect(parseWeightKg('500kg')).toBe(500);
      expect(parseWeightKg('125.5 kg')).toBe(125.5);
    });

    it('should correctly parse weight strings in tonnes/tons and convert to kg', () => {
      expect(parseWeightKg('2 tonnes')).toBe(2000);
      expect(parseWeightKg('1.5 tons')).toBe(1500);
    });

    it('should return default or 0 for invalid or unparseable weights', () => {
      expect(parseWeightKg(null)).toBe(0);
      expect(parseWeightKg('unknown')).toBe(0);
    });
  });

  describe('parseDimensions', () => {
    it('should correctly parse dimension strings in meters (m)', () => {
      expect(parseDimensions('10x5x3 m')).toEqual({ length: 10, width: 5, height: 3 });
    });

    it('should correctly parse and convert dimension strings in feet (ft) to meters', () => {
      const dims = parseDimensions('32.8x16.4x9.8 ft');
      expect(dims.length).toBeCloseTo(10, 0);
    });

    it('should return null or fallback for malformed dimension strings', () => {
      expect(parseDimensions('invalid-dims')).toBeNull();
    });
  });

  describe('guardMlApiKey', () => {
    beforeEach(() => {
      delete process.env.ML_API_KEY;
    });

    it('should throw an error when ML_API_KEY is missing in production/strict mode', () => {
      expect(() => guardMlApiKey()).toThrowError(/ML_API_KEY is required/i);
    });

    it('should pass without throwing when ML_API_KEY is present', () => {
      process.env.ML_API_KEY = 'test-ml-key-123';
      expect(() => guardMlApiKey()).not.toThrow();
    });
  });
});
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));
import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.ML_API_KEY = 'test-key';
process.env.ML_ENGINE_URL = 'http://ml-engine.test';

import { predictDemand } from '../../src/services/ml.js';

describe('ml.js predictDemand', () => {
  afterEach(() => {
    delete process.env.ML_API_KEY;
    delete process.env.ML_ENGINE_URL;
    delete globalThis.fetch;
  });

  it('throws when ML_API_KEY is not configured', async () => {
    delete process.env.ML_API_KEY;
    await expect(predictDemand({ lat: 28, lng: 77 })).rejects.toThrow(/ML_API_KEY/);
  });

  it('returns a prediction for valid location and time', async () => {
    process.env.ML_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ demand: 42, currency: 'loads' }),
    });

    const result = await predictDemand({ lat: 28.6139, lng: 77.2090 }, Date.now());
    expect(result).toHaveProperty('demand');
    expect(typeof result.demand).toBe('number');
    expect(result.demand).toBe(42);
  });

  it('throws when the ML endpoint returns an error', async () => {
    process.env.ML_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'model unavailable',
    });

    await expect(predictDemand({ lat: 28, lng: 77 })).rejects.toThrow(/503/);
  });
});
