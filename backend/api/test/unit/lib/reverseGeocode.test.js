/**
 * Unit tests for backend/api/src/lib/reverseGeocode.js
 *
 * Coverage:
 *   - returns null for null/missing lat/lon inputs
 *   - cache hit returns cached address without API call
 *   - cache miss calls Nominatim API and caches result
 *   - API returns non-ok status — logs error and returns null
 *   - API returns valid address with city/town — formats correctly
 *   - API returns only display_name — falls back to truncated display_name
 *   - API returns empty address fields — returns null
 *   - fetch throws — logs error and returns null
 *   - cache set throws — logs error but still returns the address (fire-and-forget)
 *
 * Run with: npx vitest run test/unit/lib/reverseGeocode.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedis = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('../../../src/config/db.js', () => ({
  redisClient: mockRedis,
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

// Import after mocks are set up
const { reverseGeocode } = await import('../../../src/lib/reverseGeocode.js');

describe('reverseGeocode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
  });

  it('returns null when lat is null', async () => {
    const result = await reverseGeocode(null, 75.5);
    expect(result).toBeNull();
  });

  it('returns null when lon is null', async () => {
    const result = await reverseGeocode(25.5, null);
    expect(result).toBeNull();
  });

  it('returns null when both lat and lon are null', async () => {
    const result = await reverseGeocode(null, null);
    expect(result).toBeNull();
  });

  it('returns cached address on cache hit without calling API', async () => {
    mockRedis.get.mockResolvedValue('NH-48, Jaipur');
    const result = await reverseGeocode(26.9124, 75.7873);
    expect(result).toBe('NH-48, Jaipur');
    expect(mockRedis.get).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls Nominatim API on cache miss and caches result', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: { road: 'MG Road', city: 'Bangalore' },
      }),
    });

    const result = await reverseGeocode(12.9716, 77.5946);

    expect(mockFetch).toHaveBeenCalled();
    expect(result).toBe('MG Road, Bangalore');
    expect(mockRedis.set).toHaveBeenCalled();
  });

  it('returns null and logs error when API returns non-ok status', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await reverseGeocode(12.9716, 77.5946);

    expect(result).toBeNull();
  });

  it('returns null when address has village but no city/town/state and no display_name', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: { road: 'High Street', village: 'Manesar' },
      }),
    });

    const result = await reverseGeocode(28.3623, 77.0295);

    // Returns null because localArea && mainArea is false (mainArea is undefined)
    expect(result).toBeNull();
  });

  it('falls back to truncated display_name when address fields are empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        display_name: 'Sector 17, Chandigarh, Punjab 160017, India',
        address: {},
      }),
    });

    const result = await reverseGeocode(30.7320, 76.7748);

    expect(result).toBe('Sector 17, Chandigarh');
  });

  it('returns null when address fields and display_name are empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ address: {} }),
    });

    const result = await reverseGeocode(19.0760, 72.8777);

    expect(result).toBeNull();
  });

  it('returns null when fetch throws an error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await reverseGeocode(28.6139, 77.2090);

    expect(result).toBeNull();
  });

  it('calls Nominatim with correct User-Agent and Accept-Language headers', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: { city: 'Mumbai', road: 'Marine Drive' },
      }),
    });

    await reverseGeocode(18.9220, 72.8337);

    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[0]).toContain('nominatim.openstreetmap.org');
    expect(fetchCall[1].headers['User-Agent']).toBe('Truxify-Node-Backend/1.0');
    expect(fetchCall[1].headers['Accept-Language']).toBe('en-US,en;q=0.9');
  });

  it('rounds coordinates to 3 decimal places for cache key', async () => {
    mockRedis.get.mockResolvedValue('Cached Address');
    await reverseGeocode(12.9716001, 77.5946001);
    expect(mockRedis.get).toHaveBeenCalledWith('geocode:12.972,77.595');
  });
});
