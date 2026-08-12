/**
 * Unit tests for backend/api/src/lib/reverseGeocode.js
 *
 * Run with:  npm run test:unit -- test/unit/reverseGeocode.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock redis client
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
vi.mock('../../src/config/db.js', () => ({
  redisClient: {
    get: mockRedisGet,
    set: mockRedisSet,
  },
}));

const { reverseGeocode } = await import('../../src/lib/reverseGeocode.js');

describe('reverseGeocode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for null lat', async () => {
    const result = await reverseGeocode(null, 72.5);
    expect(result).toBeNull();
  });

  it('returns null for null lon', async () => {
    const result = await reverseGeocode(23.0, null);
    expect(result).toBeNull();
  });

  it('returns null for NaN lat', async () => {
    const result = await reverseGeocode(NaN, 72.5);
    expect(result).toBeNull();
  });

  it('returns null for NaN lon', async () => {
    const result = await reverseGeocode(23.0, NaN);
    expect(result).toBeNull();
  });

  it('returns null for out-of-bounds lat (< -90 or > 90)', async () => {
    expect(await reverseGeocode(95.0, 72.5)).toBeNull();
    expect(await reverseGeocode(-95.0, 72.5)).toBeNull();
  });

  it('returns null for out-of-bounds lon (< -180 or > 180)', async () => {
    expect(await reverseGeocode(23.0, 185.0)).toBeNull();
    expect(await reverseGeocode(23.0, -185.0)).toBeNull();
  });

  it('returns null for Infinity coordinates', async () => {
    expect(await reverseGeocode(Infinity, 72.5)).toBeNull();
    expect(await reverseGeocode(23.0, -Infinity)).toBeNull();
  });

  it('returns null for hex-like string coordinates', async () => {
    expect(await reverseGeocode('0x10', '72.5')).toBeNull();
    expect(await reverseGeocode('23.0', '0x1A')).toBeNull();
  });

  it('returns cached value from Redis when available', async () => {
    mockRedisGet.mockResolvedValue('MG Road, Mumbai');
    const result = await reverseGeocode(19.076, 72.8777);
    expect(result).toBe('MG Road, Mumbai');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls Nominatim API when cache misses', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: { road: 'MG Road', city: 'Mumbai' },
        display_name: 'MG Road, Mumbai, India',
      }),
    });

    const result = await reverseGeocode(19.076, 72.8777);
    expect(result).toBe('MG Road, Mumbai');
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('returns null when Nominatim API returns non-ok response', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
    });

    const result = await reverseGeocode(19.076, 72.8777);
    expect(result).toBeNull();
  });

  it('retries after the Retry-After delay on a 429 response', async () => {
    mockRedisGet.mockResolvedValue(null);
    // First call: 429 with a 1-second Retry-After. Second call succeeds.
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => '1' },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          address: { road: 'MG Road', city: 'Mumbai' },
        }),
      });

    const result = await reverseGeocode(19.076, 72.8777);
    expect(result).toBe('MG Road, Mumbai');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('rounds coordinates to 3 decimal places for cache key', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ address: {}, display_name: 'Test' }),
    });

    await reverseGeocode(19.07612345, 72.87776543);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('lat=19.076');
    expect(calledUrl).toContain('lon=72.878');
  });

  it('returns null when Nominatim response has no address data', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await reverseGeocode(19.076, 72.8777);
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await reverseGeocode(19.076, 72.8777);
    expect(result).toBeNull();
  });
});
