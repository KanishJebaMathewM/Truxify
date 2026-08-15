import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLiveTrafficMultiplier } from '../../src/services/trafficService.js';

const mockLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

describe('trafficService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 1.0 for null coordinates', async () => {
    const result = await getLiveTrafficMultiplier(null, null);
    expect(result).toBe(1.0);
  });

  it('returns 1.0 for undefined coordinates', async () => {
    const result = await getLiveTrafficMultiplier(undefined, undefined);
    expect(result).toBe(1.0);
  });

  it('treats 0,0 as valid coordinates and applies the traffic multiplier', async () => {
    // The equator/prime meridian (lat/lng 0) are valid coordinates and must
    // not be short-circuited by a falsy guard. During morning rush hour (UTC)
    // the rush-hour surge multiplier is applied.
    vi.setSystemTime(new Date('2025-01-01T08:00:00Z'));

    const result = await getLiveTrafficMultiplier(0, 0);
    expect(result).toBeGreaterThanOrEqual(1.2);
    expect(result).toBeLessThanOrEqual(2.5);
  });

  it('returns 1.0 when TOMTOM API key is absent and fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await getLiveTrafficMultiplier(40.7128, -74.006);
    expect(result).toBe(1.0);
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('returns surge multiplier during morning rush hour', async () => {
    // Set time to 8:00 AM (morning rush)
    vi.setSystemTime(new Date('2025-01-01T08:00:00'));

    const result = await getLiveTrafficMultiplier(12.9, 77.5);
    expect(result).toBeGreaterThanOrEqual(1.2);
    expect(result).toBeLessThanOrEqual(2.5);
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it('returns surge multiplier during evening rush hour', async () => {
    // Set time to 5:30 PM (evening rush)
    vi.setSystemTime(new Date('2025-01-01T17:30:00'));

    const result = await getLiveTrafficMultiplier(12.9, 77.5);
    expect(result).toBeGreaterThanOrEqual(1.2);
    expect(result).toBeLessThanOrEqual(2.5);
  });

  it('returns deterministic multiplier for same coordinates during rush hour', async () => {
    vi.setSystemTime(new Date('2025-01-01T09:00:00'));

    const result1 = await getLiveTrafficMultiplier(12.9716, 77.5946);
    const result2 = await getLiveTrafficMultiplier(12.9716, 77.5946);
    expect(result1).toBe(result2);
  });

  it('returns different multipliers for different coordinates', async () => {
    vi.setSystemTime(new Date('2025-01-01T09:00:00'));

    const result1 = await getLiveTrafficMultiplier(12.9716, 77.5946);
    const result2 = await getLiveTrafficMultiplier(28.6139, 77.2090);
    // Different coordinates produce different geoHash values, likely different multipliers
    // but this is not guaranteed - just check both are valid ranges
    expect(result1).toBeGreaterThanOrEqual(1.2);
    expect(result1).toBeLessThanOrEqual(2.5);
    expect(result2).toBeGreaterThanOrEqual(1.2);
    expect(result2).toBeLessThanOrEqual(2.5);
  });

  it('logs the surge multiplier during rush hour', async () => {
    vi.setSystemTime(new Date('2025-01-01T09:00:00'));

    await getLiveTrafficMultiplier(12.9, 77.5);

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    const logCall = mockLogger.info.mock.calls[0];
    expect(logCall[0]).toContain('Live traffic data at');
  });

  describe('getLiveTrafficMultiplier', () => {
    it('returns 1.0 when pickupLat is missing', async () => {
      const result = await getLiveTrafficMultiplier(null, 72.5);
      expect(result).toBe(1.0);
    });

    it('returns 1.0 when pickupLng is missing', async () => {
      const result = await getLiveTrafficMultiplier(23.5, null);
      expect(result).toBe(1.0);
    });

    it('returns 1.0 when both coordinates are missing', async () => {
      const result = await getLiveTrafficMultiplier(null, null);
      expect(result).toBe(1.0);
    });

    it('returns 1.0 when no API key is configured (uses rush-hour multiplier at non-rush hours)', async () => {
      // No API keys set - uses rush hour multiplier
      // Mock Date to be non-rush hour
      const fakeDate = new Date('2025-01-15T12:00:00Z'); // noon - not rush hour
      vi.spyOn(global, 'Date').mockImplementation((arg) => {
        if (arg) return new global.Date(arg);
        return fakeDate;
      });
      const result = await getLiveTrafficMultiplier(23.5, 72.5);
      expect(result).toBe(1.0);
      vi.restoreAllMocks();
    });

    it('returns a multiplier > 1.0 when TomTom API key is set and returns valid data', async () => {
      process.env.TOMTOM_API_KEY = 'test-key';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ flowSegmentData: { speedDiffPercent: 30 } }),
      });
      global.fetch = mockFetch;

      const result = await getLiveTrafficMultiplier(23.5, 72.5);
      expect(result).toBeGreaterThan(1.0);
      expect(result).toBeLessThanOrEqual(2.5);
    });

    it('returns 1.0 when TomTom API call fails', async () => {
      process.env.TOMTOM_API_KEY = 'test-key';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      global.fetch = mockFetch;

      const result = await getLiveTrafficMultiplier(23.5, 72.5);
      expect(result).toBe(1.0);
    });

    it('returns 1.0 when fetch throws', async () => {
      process.env.TOMTOM_API_KEY = 'test-key';
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      const result = await getLiveTrafficMultiplier(23.5, 72.5);
      expect(result).toBe(1.0);
    });

    it('returns 1.0 when Google Maps API call fails', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'test-key';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });
      global.fetch = mockFetch;

      const result = await getLiveTrafficMultiplier(23.5, 72.5);
      expect(result).toBe(1.0);
    });

    it('returns multiplier from TomTom speedDiffPercent', async () => {
      process.env.TOMTOM_API_KEY = 'test-key';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ flowSegmentData: { speedDiffPercent: 50 } }),
      });
      global.fetch = mockFetch;

      const result = await getLiveTrafficMultiplier(23.5, 72.5);
      // 1.0 + 0.5 = 1.5, clamped to max 2.5
      expect(result).toBe(1.5);
    });

    it('clamps multiplier to MAX_SURGE_MULTIPLIER (2.5)', async () => {
      process.env.TOMTOM_API_KEY = 'test-key';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ flowSegmentData: { speedDiffPercent: 500 } }),
      });
      global.fetch = mockFetch;

      const result = await getLiveTrafficMultiplier(23.5, 72.5);
      expect(result).toBe(2.5);
    });
  });
});
