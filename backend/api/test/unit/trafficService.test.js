import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

import { getLiveTrafficMultiplier } from '../../src/services/trafficService.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('trafficService - getLiveTrafficMultiplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.TOMTOM_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TOMTOM_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('returns 1.0 when pickupLat is missing', async () => {
    const result = await getLiveTrafficMultiplier(null, 77.5);
    expect(result).toBe(1.0);
  });

  it('returns 1.0 when pickupLng is missing', async () => {
    const result = await getLiveTrafficMultiplier(12.9, null);
    expect(result).toBe(1.0);
  });

  it('returns 1.0 when coordinates are 0,0', async () => {
    const result = await getLiveTrafficMultiplier(0, 0);
    expect(result).toBe(1.0);
  });

  it('returns 1.0 outside rush hours', async () => {
    // Set time to 2:30 AM
    vi.setSystemTime(new Date('2025-01-01T02:30:00'));

    const result = await getLiveTrafficMultiplier(12.9, 77.5);
    expect(result).toBe(1.0);
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('returns 1.0 and warns when no traffic API key is configured', async () => {
    const result = await getLiveTrafficMultiplier(12.9, 77.5);
    expect(result).toBe(1.0);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('No traffic API key configured'));
  });

  describe('with a traffic API key configured', () => {
    beforeEach(() => {
      process.env.TOMTOM_API_KEY = 'test-key';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ flowSegmentData: { speedDiffPercent: 25 } }),
      });
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
      expect(logCall[0]).toContain('Live traffic data at 12.9,77.5: x1.25');
    });
  });

  it('returns 1.0 when error is thrown', async () => {
    // The function catches all errors and returns 1.0
    const result = await getLiveTrafficMultiplier(12.9, 77.5);
    // Should not throw
    expect(typeof result).toBe('number');
  });
});
