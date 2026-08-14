import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchEnRouteLoads } from '../../src/services/ml.js';

const mockLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

describe('matchEnRouteLoads haversine fallback', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ML_API_KEY;

  const offers = [
    {
      id: 'load-1',
      pickup_lat: 12.9,
      pickup_lng: 77.5,
      drop_lat: 13.0,
      drop_lng: 80.2,
      weight: '3 tonnes',
      payment_inr: 1000,
      freight_value: null,
    },
    {
      id: 'load-2',
      pickup_lat: 28.6,
      pickup_lng: 77.2,
      drop_lat: 19.0,
      drop_lng: 72.8,
      weight: '5 tonne',
      payment_inr: null,
      freight_value: 250000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ML_API_KEY = 'test-key';
    // The ML engine call must fail so the haversine fallback runs.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ML engine unreachable'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ML_API_KEY;
    else process.env.ML_API_KEY = originalKey;
  });

  it('returns an empty array for no offers', async () => {
    const result = await matchEnRouteLoads({ currentLat: 12, currentLng: 77, offers: [] });
    expect(result).toEqual([]);
  });

  it('falls back to haversine ranking when the ML engine fails', async () => {
    const result = await matchEnRouteLoads({
      currentLat: 12.9,
      currentLng: 77.5,
      offers,
      maxDetourKm: 2000,
    });

    expect(result.length).toBe(2);
    // The nearest pickup (load-1) ranks first.
    expect(result[0].id).toBe('load-1');
    expect(result[0].ml_used).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('filters out offers beyond the max detour', async () => {
    const result = await matchEnRouteLoads({
      currentLat: 12.9,
      currentLng: 77.5,
      offers,
      maxDetourKm: 10,
    });

    // load-2 is ~1700 km away; only load-1 stays within 10 km.
    expect(result.map((r) => r.id)).toEqual(['load-1']);
  });
});
