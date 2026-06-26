import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRedis = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: mockRedis,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

import { getRouteEstimate, __testing } from '../../src/services/osrm.js';

const { buildRouteUrl, buildCacheKey, DEFAULT_OSRM_BASE_URL, DEFAULT_TIMEOUT_MS } = __testing;


describe('osrm - buildRouteUrl', () => {
  it('builds correct URL with coordinates', () => {
    const url = buildRouteUrl({
      pickupLat: 12.9716,
      pickupLng: 77.5946,
      dropLat: 13.0827,
      dropLng: 80.2707,
    });

    expect(url.toString()).toContain('77.5946,12.9716;80.2707,13.0827');
    expect(url.searchParams.get('overview')).toBe('false');
    expect(url.searchParams.get('steps')).toBe('false');
  });

  it('uses OSRM_BASE_URL env variable when set', () => {
    process.env.OSRM_BASE_URL = 'http://my-osrm-server.com';

    const url = buildRouteUrl({
      pickupLat: 12.9716,
      pickupLng: 77.5946,
      dropLat: 13.0827,
      dropLng: 80.2707,
    });

    expect(url.toString()).toContain('my-osrm-server.com');

    delete process.env.OSRM_BASE_URL;
  });

  it('falls back to DEFAULT_OSRM_BASE_URL when env not set', () => {
    const url = buildRouteUrl({
      pickupLat: 1, pickupLng: 2, dropLat: 3, dropLng: 4,
    });

    expect(url.toString()).toContain(DEFAULT_OSRM_BASE_URL.replace('https://', ''));
  });
});

describe('osrm - buildCacheKey', ()=> {
  it('rounds coordinates to 4 decimanl places', () => {
    const key = buildCacheKey({
      pickupLat: 12.9715987,
      pickupLng: 77.5945627,
      dropLat: 13.0827,
      dropLng: 80.2707,
    });
    expect(key).toBe('osrm:route:12.9716:77.5946:13.0827:80.2707');
  });

  it('produces same key for coordinates that round to same values', () => {
    const key1 = buildCacheKey({ pickupLat: 12.97161, pickupLng: 77.5, dropLat:13.0, dropLng: 80.0});
    const key2 = buildCacheKey({ pickupLat: 12.97164, pickupLng: 77.5, dropLat:13.0, dropLng:80.0});
    expect(key1).toBe(key2);
  });

  it('produces different keys for different coordinates', () => {
    const key1 = buildCacheKey({ pickupLat: 12.97161, pickupLng: 77.5, dropLat:13.0, dropLng: 80.0});
    const key2 = buildCacheKey({ pickupLat: 12.97174, pickupLng: 77.5, dropLat:13.0, dropLng:80.0});
    expect(key1).not.toBe(key2);
  });
})

describe('osrm - getRouteEstimate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns null when coordinates are missing', async () => {
    const result = await getRouteEstimate({});
    expect(result).toBeNull();
  });

  it('returns null when coordinates are non-finite', async () => {
    const result = await getRouteEstimate({
      pickupLat: NaN,
      pickupLng: 77.5,
      dropLat: 13.0,
      dropLng: 80.2,
    });
    expect(result).toBeNull();
  });

  it('returns null when called with no arguments', async () => {
    const result = await getRouteEstimate();
    expect(result).toBeNull();
  });

  it('returns null when fetch response is not ok', async () => {
    fetch.mockResolvedValue({ ok: false });

    const result = await getRouteEstimate({
      pickupLat: 12.9, pickupLng: 77.5, dropLat: 13.0, dropLng: 80.2,
    });

    expect(result).toBeNull();
  });

  it('returns null when routes array is empty', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [] }),
    });

    const result = await getRouteEstimate({
      pickupLat: 12.9, pickupLng: 77.5, dropLat: 13.0, dropLng: 80.2,
    });

    expect(result).toBeNull();
  });

  it('returns null when route distance is invalid', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distance: -1, duration: 3600 }] }),
    });

    const result = await getRouteEstimate({
      pickupLat: 12.9, pickupLng: 77.5, dropLat: 13.0, dropLng: 80.2,
    });

    expect(result).toBeNull();
  });

  it('returns distanceKm and durationSeconds on valid response', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [{ distance: 45000, duration: 3600 }],
      }),
    });

    const result = await getRouteEstimate({
      pickupLat: 12.9, pickupLng: 77.5, dropLat: 13.0, dropLng: 80.2,
    });

    expect(result).toEqual({ distanceKm: 45, durationSeconds: 3600 });
  });

  it('returns null durationSeconds when duration is not finite', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [{ distance: 20000, duration: NaN }],
      }),
    });

    const result = await getRouteEstimate({
      pickupLat: 12.9, pickupLng: 77.5, dropLat: 13.0, dropLng: 80.2,
    });

    expect(result).toEqual({ distanceKm: 20, durationSeconds: null });
  });

  it('returns null when fetch throws (e.g. timeout/abort)', async () => {
    fetch.mockRejectedValue(new Error('AbortError'));

    const result = await getRouteEstimate({
      pickupLat: 12.9, pickupLng: 77.5, dropLat: 13.0, dropLng: 80.2,
    });

    expect(result).toBeNull();
    // After retries are exhausted, error is logged with 'after all retries' message
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[osrm] Fetch error after all retries:', 'AbortError'
    );
  });

  it('uses OSRM_TIMEOUT_MS env variable', async () => {
    process.env.OSRM_TIMEOUT_MS = '3000';

    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distance: 10000, duration: 600 }] }),
    });

    const result = await getRouteEstimate({
      pickupLat: 12.9, pickupLng: 77.5, dropLat: 13.0, dropLng: 80.2,
    });

    expect(result).not.toBeNull();

    delete process.env.OSRM_TIMEOUT_MS;
  });

  it('returns cached result without calling fetch on cache hit', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ distanceKm: 45, durationSeconds: 3600 }));

    const result = await getRouteEstimate({
      pickupLat: 12.9716, pickupLng: 77.5946, dropLat: 13.0827, dropLng: 80.2707,
    });

    expect(result).toEqual({ distanceKm: 45, durationSeconds: 3600 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('queries Redis with the correct cache key', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ distanceKm: 10, durationSeconds: 600 }));

    await getRouteEstimate({
      pickupLat: 12.9715987, pickupLng: 77.5945627, dropLat: 13.0827, dropLng: 80.2707,
    });

    expect(mockRedis.get).toHaveBeenCalledWith('osrm:route:12.9716:77.5946:13.0827:80.2707');
  });

  it('calls OSRM and stores result in Redis on cache miss', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distance: 45000, duration: 3600 }] }),
    });

    const result = await getRouteEstimate({
      pickupLat: 12.9716, pickupLng: 77.5946, dropLat: 13.0827, dropLng: 80.2707,
    });

    expect(result).toEqual({ distanceKm: 45, durationSeconds: 3600 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(mockRedis.set).toHaveBeenCalledWith(
      'osrm:route:12.9716:77.5946:13.0827:80.2707',
      JSON.stringify(result),
      'EX',
      86400
    );
  });

  it('falls back to OSRM when Redis get throws', async () => {
    mockRedis.get.mockRejectedValue(new Error('Redis connection refused'));
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distance: 20000, duration: 900 }] }),
    });

    const result = await getRouteEstimate({
      pickupLat: 12.9716, pickupLng: 77.5946, dropLat: 13.0827, dropLng: 80.2707,
    });

    expect(result).toEqual({ distanceKm: 20, durationSeconds: 900 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(mockLogger.error).toHaveBeenCalledWith('[osrm] Redis get error:', 'Redis connection refused');
  });

  it('returns result even when Redis set throws after successful OSRM response', async () => {
    mockRedis.set.mockRejectedValue(new Error('Redis write failed'));
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distance: 10000, duration: 600 }] }),
    });

    const result = await getRouteEstimate({
      pickupLat: 12.9716, pickupLng: 77.5946, dropLat: 13.0827, dropLng: 80.2707,
    });

    expect(result).toEqual({ distanceKm: 10, durationSeconds: 600 });
    expect(mockLogger.error).toHaveBeenCalledWith('[osrm] Redis set error:', 'Redis write failed');
  });

  it('does not cache null when OSRM returns a non-ok response', async () => {
    fetch.mockResolvedValue({ ok: false });

    await getRouteEstimate({
      pickupLat: 12.9716, pickupLng: 77.5946, dropLat: 13.0827, dropLng: 80.2707,
    });

    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('does not cache null when OSRM returns an invalid route', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [] }),
    });

    await getRouteEstimate({
      pickupLat: 12.9716, pickupLng: 77.5946, dropLat: 13.0827, dropLng: 80.2707,
    });

    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});