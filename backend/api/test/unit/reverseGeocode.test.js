/**
 * Unit tests for backend/api/src/lib/reverseGeocode.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { mockFetch, mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
}));

global.fetch = mockFetch;

vi.mock('../../src/config/db.js', () => ({
  redisClient: {
    get: mockRedisGet,
    set: mockRedisSet,
  },
}));

import { reverseGeocode, clampGeohashPrecision, getTimeoutMs } from '../../src/lib/reverseGeocode.js';

describe('reverseGeocode - Comprehensive Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('coordinate validation', () => {
    it('returns null when latitude or longitude is null or undefined', async () => {
      expect(await reverseGeocode(null, 72.5)).toBeNull();
      expect(await reverseGeocode(23.0, null)).toBeNull();
      expect(await reverseGeocode(undefined, 72.5)).toBeNull();
      expect(await reverseGeocode(23.0, undefined)).toBeNull();
      expect(mockRedisGet).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null for NaN or non-numeric coordinate strings and does not query cache', async () => {
      expect(await reverseGeocode(NaN, 72.5)).toBeNull();
      expect(await reverseGeocode(23.0, NaN)).toBeNull();
      expect(await reverseGeocode('invalid', 72.5)).toBeNull();
      expect(await reverseGeocode(23.0, 'not-a-number')).toBeNull();
      expect(await reverseGeocode('NaN', 'NaN')).toBeNull();
      expect(mockRedisGet).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null for Infinity or -Infinity lat/lng values', async () => {
      expect(await reverseGeocode(Infinity, 72.5)).toBeNull();
      expect(await reverseGeocode(-Infinity, 72.5)).toBeNull();
      expect(await reverseGeocode(23.0, Infinity)).toBeNull();
      expect(await reverseGeocode(23.0, -Infinity)).toBeNull();
    });

    it('returns null for out-of-range latitude (< -90 or > 90)', async () => {
      expect(await reverseGeocode(-90.1, 72.5)).toBeNull();
      expect(await reverseGeocode(90.1, 72.5)).toBeNull();
      expect(await reverseGeocode(-120, 72.5)).toBeNull();
      expect(await reverseGeocode(120, 72.5)).toBeNull();
    });

    it('returns null for out-of-range longitude (< -180 or > 180)', async () => {
      expect(await reverseGeocode(23.0, -180.1)).toBeNull();
      expect(await reverseGeocode(23.0, 180.1)).toBeNull();
      expect(await reverseGeocode(23.0, -200)).toBeNull();
      expect(await reverseGeocode(23.0, 200)).toBeNull();
    });
  });

  describe('cache hit behavior', () => {
    it('returns cached value from Redis without calling Nominatim API', async () => {
      mockRedisGet.mockResolvedValue('MG Road, Mumbai');

      const result = await reverseGeocode(19.076, 72.8777);

      expect(result).toBe('MG Road, Mumbai');
      expect(mockRedisGet).toHaveBeenCalledWith('geocode:19.076,72.878');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('cache miss and Nominatim API behavior', () => {
    it('calls Nominatim API on cache miss, caches the result, and returns formatted address', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          address: {
            road: 'MG Road',
            city: 'Mumbai',
            state: 'Maharashtra',
          },
          display_name: 'MG Road, Mumbai, Maharashtra, India',
        }),
      });

      const result = await reverseGeocode(19.076, 72.8777);

      expect(result).toBe('MG Road, Mumbai');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('lat=19.076');
      expect(url).toContain('lon=72.878');
      expect(mockRedisSet).toHaveBeenCalledWith(
        'geocode:19.076,72.878',
        'MG Road, Mumbai',
        'EX',
        7 * 24 * 60 * 60
      );
    });

    it('formats address with fallback to mainArea or display_name when localArea is not present', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          address: {
            city: 'Bengaluru',
            state: 'Karnataka',
          },
          display_name: 'Bengaluru, Karnataka, India',
        }),
      });

      const result = await reverseGeocode(12.9716, 77.5946);
      expect(result).toBe('Bengaluru');
    });

    it('falls back to truncated display_name when address details are minimal', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          address: {},
          display_name: 'Indira Gandhi International Airport, New Delhi, Delhi, India',
        }),
      });

      const result = await reverseGeocode(28.5562, 77.1000);
      expect(result).toBe('Indira Gandhi International Airport, New Delhi');
    });

    it('handles rate-limiting (429) with Retry-After and successfully retries', async () => {
      vi.useFakeTimers();
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');

      const headers = new Map();
      headers.set('Retry-After', '2');

      const response429 = {
        ok: false,
        status: 429,
        headers: {
          get: (name) => headers.get(name),
        },
      };

      const response200 = {
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        json: () => Promise.resolve({
          address: {
            road: 'Station Road',
            city: 'Jaipur',
          },
        }),
      };

      mockFetch.mockResolvedValueOnce(response429).mockResolvedValueOnce(response200);

      const promise = reverseGeocode(26.9124, 75.7873);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(result).toBe('Station Road, Jaipur');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockRedisSet).toHaveBeenCalledWith('geocode:26.912,75.787', 'Station Road, Jaipur', 'EX', 604800);
      vi.useRealTimers();
    });

    it('formats address properly with village, town, and state combinations', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          address: {
            village: 'Chomu',
            state: 'Rajasthan',
          },
        }),
      });

      const result = await reverseGeocode(27.1700, 75.7200);
      expect(result).toBe('Chomu, Rajasthan');
    });

    it('handles suburb and town combinations', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          address: {
            suburb: 'Bandra West',
            town: 'Mumbai Suburban',
          },
        }),
      });

      const result = await reverseGeocode(19.0596, 72.8295);
      expect(result).toBe('Bandra West, Mumbai Suburban');
    });
    it('handles rate-limiting (429) when Retry-After header is missing or non-numeric by defaulting to 60s wait', async () => {
      vi.useFakeTimers();
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');

      const response429 = {
        ok: false,
        status: 429,
        headers: {
          get: () => null,
        },
      };

      const response200 = {
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        json: () => Promise.resolve({
          address: {
            city: 'Delhi',
          },
        }),
      };

      mockFetch.mockResolvedValueOnce(response429).mockResolvedValueOnce(response200);

      const promise = reverseGeocode(28.6139, 77.2090);
      await vi.advanceTimersByTimeAsync(60000);
      const result = await promise;

      expect(result).toBe('Delhi');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ waitMs: 60000 }),
        expect.stringContaining('Rate-limited')
      );
      vi.useRealTimers();
    });

    it('clamps Retry-After wait time to a maximum of 60 seconds when header exceeds 60s', async () => {
      vi.useFakeTimers();
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');

      const headers = new Map();
      headers.set('Retry-After', '120'); // 120 seconds

      const response429 = {
        ok: false,
        status: 429,
        headers: {
          get: (name) => headers.get(name),
        },
      };

      const response200 = {
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        json: () => Promise.resolve({
          address: {
            city: 'Mumbai',
          },
        }),
      };

      mockFetch.mockResolvedValueOnce(response429).mockResolvedValueOnce(response200);

      const promise = reverseGeocode(19.076, 72.8777);
      await vi.advanceTimersByTimeAsync(60000);
      const result = await promise;

      expect(result).toBe('Mumbai');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ waitMs: 60000 }),
        expect.stringContaining('Rate-limited')
      );
      vi.useRealTimers();
    });

    it('handles numeric string coordinates and rounds to 3 decimal places', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          address: {
            road: 'Ring Road',
            city: 'Pune',
          },
        }),
      });

      const result = await reverseGeocode('18.520430', '73.856743');

      expect(result).toBe('Ring Road, Pune');
      expect(mockRedisGet).toHaveBeenCalledWith('geocode:18.520,73.857');
      expect(mockRedisSet).toHaveBeenCalledWith('geocode:18.520,73.857', 'Ring Road, Pune', 'EX', 604800);
    });
  });

  describe('timeout handling and environment configuration', () => {
    const originalEnv = process.env.NOMINATIM_TIMEOUT_MS;

    beforeEach(() => {
      process.env.NOMINATIM_TIMEOUT_MS = originalEnv;
    });

    it('handles timeout error gracefully when fetch aborts or times out', async () => {
      mockRedisGet.mockResolvedValue(null);
      const timeoutError = new Error('The operation was aborted due to timeout');
      timeoutError.name = 'TimeoutError';
      mockFetch.mockRejectedValue(timeoutError);

      const result = await reverseGeocode(19.076, 72.8777);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: timeoutError }),
        '[ReverseGeocode] Error reverse geocoding coordinates'
      );
    });

    it('passes AbortSignal to fetch and respects NOMINATIM_TIMEOUT_MS env var', async () => {
      process.env.NOMINATIM_TIMEOUT_MS = '2500';
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          address: { city: 'Chennai' },
        }),
      });

      const result = await reverseGeocode(13.0827, 80.2707);

      expect(result).toBe('Chennai');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchOptions = mockFetch.mock.calls[0][1];
      expect(fetchOptions.signal).toBeDefined();
    });

    it('getTimeoutMs guards against null, undefined, NaN, negative, and non-numeric inputs', () => {
      expect(getTimeoutMs(null)).toBe(5000);
      expect(getTimeoutMs(undefined)).toBe(5000);
      expect(getTimeoutMs(NaN)).toBe(5000);
      expect(getTimeoutMs('NaN')).toBe(5000);
      expect(getTimeoutMs('invalid')).toBe(5000);
      expect(getTimeoutMs(0)).toBe(5000);
      expect(getTimeoutMs(-500)).toBe(5000);
      expect(getTimeoutMs(2500)).toBe(2500);
      expect(getTimeoutMs('2500')).toBe(2500);
    });
  });

  describe('error handling and failure cases', () => {
    it('returns null gracefully when Nominatim API returns a non-ok status', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await reverseGeocode(19.076, 72.8777);

      expect(result).toBeNull();
      expect(mockRedisSet).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('returns null gracefully on network or JSON parsing error', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockRejectedValue(new Error('Network connection timeout'));

      const result = await reverseGeocode(19.076, 72.8777);

      expect(result).toBeNull();
      expect(mockRedisSet).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('returns null when Nominatim returns payload without address or display_name', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const result = await reverseGeocode(19.076, 72.8777);

      expect(result).toBeNull();
      expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('catches and logs Redis read/write errors without crashing', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis connection refused'));

      const result = await reverseGeocode(19.076, 72.8777);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});

describe('clampGeohashPrecision', () => {
  it('returns default (6) for undefined or NaN', () => {
    expect(clampGeohashPrecision(undefined)).toBe(6);
    expect(clampGeohashPrecision(NaN)).toBe(6);
    expect(clampGeohashPrecision('invalid')).toBe(6);
  });

  it('clamps values below MIN (1)', () => {
    expect(clampGeohashPrecision(null)).toBe(1);
    expect(clampGeohashPrecision(0)).toBe(1);
    expect(clampGeohashPrecision(-5)).toBe(1);
  });

  it('clamps values above MAX (12)', () => {
    expect(clampGeohashPrecision(13)).toBe(12);
    expect(clampGeohashPrecision(25)).toBe(12);
  });

  it('preserves and floors values within [1, 12]', () => {
    expect(clampGeohashPrecision(1)).toBe(1);
    expect(clampGeohashPrecision(7)).toBe(7);
    expect(clampGeohashPrecision(8.8)).toBe(8);
    expect(clampGeohashPrecision(12)).toBe(12);
  });
});