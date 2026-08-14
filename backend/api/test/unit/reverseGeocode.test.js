/**
 * Unit tests for backend/api/src/lib/reverseGeocode.js
 *
 * Run with:  npm run test:unit -- test/unit/reverseGeocode.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clampGeohashPrecision } from '../../src/lib/reverseGeocode.js';

// Use vi.hoisted so mock functions are accessible inside vi.mock factory (hoisted)
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


import { clampGeohashPrecision } from '../../src/lib/reverseGeocode.js';
describe('clampGeohashPrecision', () => {
  it('null -> clamped to MIN 1', () => { expect(clampGeohashPrecision(null)).toBe(1); });
  it('15 -> clamped to 12', () => { expect(clampGeohashPrecision(15)).toBe(12); });
  it('7 passes through', () => { expect(clampGeohashPrecision(7)).toBe(7); });
});

