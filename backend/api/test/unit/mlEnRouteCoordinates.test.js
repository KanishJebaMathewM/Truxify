/**
 * Regression tests for coordinate handling in matchEnRouteLoads.
 *
 * Before this change:
 *   - offers were kept with a truthiness check (`o.pickup_lat && o.pickup_lng`),
 *     which silently dropped legitimate 0 coordinates and kept out-of-range
 *     strings like '999',
 *   - _haversineKm had no finiteness guard, so a non-finite coordinate produced
 *     a NaN distance and a NaN match_score,
 *   - a NaN maxDetourKm made `detour_km <= maxDetourKm` false for every row,
 *     emptying the response instead of surfacing the bad input.
 *
 * Run with:  npm test -- test/unit/mlEnRouteCoordinates.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchEnRouteLoads, __testing } from '../../src/services/ml.js';

const mockLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

const { _validCoord, _hasValidCoordinates, _haversineKm } = __testing;

describe('_validCoord', () => {
  it('accepts coordinates inside the WGS84 range, including 0', () => {
    expect(_validCoord(0, -90, 90)).toBe(0);
    expect(_validCoord(0, -180, 180)).toBe(0);
    expect(_validCoord(19.076, -90, 90)).toBe(19.076);
    expect(_validCoord('72.8777', -180, 180)).toBe(72.8777);
    expect(_validCoord(-90, -90, 90)).toBe(-90);
    expect(_validCoord(180, -180, 180)).toBe(180);
  });

  it('rejects out-of-range values', () => {
    expect(_validCoord(90.0001, -90, 90)).toBeNull();
    expect(_validCoord(-90.0001, -90, 90)).toBeNull();
    expect(_validCoord(999, -180, 180)).toBeNull();
    expect(_validCoord('999', -180, 180)).toBeNull();
  });

  it('rejects nullish, blank and non-finite values', () => {
    expect(_validCoord(null, -90, 90)).toBeNull();
    expect(_validCoord(undefined, -90, 90)).toBeNull();
    expect(_validCoord('', -90, 90)).toBeNull();
    expect(_validCoord('   ', -90, 90)).toBeNull();
    expect(_validCoord(NaN, -90, 90)).toBeNull();
    expect(_validCoord(Infinity, -90, 90)).toBeNull();
    expect(_validCoord('abc', -90, 90)).toBeNull();
  });
});

describe('_hasValidCoordinates', () => {
  const base = { pickup_lat: 19.076, pickup_lng: 72.8777, drop_lat: 28.6139, drop_lng: 77.209 };

  it('accepts a complete in-range offer', () => {
    expect(_hasValidCoordinates(base)).toBe(true);
  });

  it('accepts an offer on the equator / prime meridian', () => {
    expect(_hasValidCoordinates({ ...base, pickup_lat: 0, pickup_lng: 0 })).toBe(true);
  });

  it('rejects an offer with an out-of-range coordinate', () => {
    expect(_hasValidCoordinates({ ...base, pickup_lat: 999 })).toBe(false);
    expect(_hasValidCoordinates({ ...base, drop_lng: -181 })).toBe(false);
  });

  it('rejects an offer with a missing coordinate', () => {
    expect(_hasValidCoordinates({ ...base, pickup_lat: null })).toBe(false);
    expect(_hasValidCoordinates({ ...base, drop_lng: '' })).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(_hasValidCoordinates(null)).toBe(false);
    expect(_hasValidCoordinates(undefined)).toBe(false);
  });
});

describe('_haversineKm finiteness guard', () => {
  it('returns null for non-finite input instead of NaN', () => {
    expect(_haversineKm(NaN, 72.87, 19.07, 72.87)).toBeNull();
    expect(_haversineKm(19.07, 'abc', 19.07, 72.87)).toBeNull();
    expect(_haversineKm(19.07, 72.87, Infinity, 72.87)).toBeNull();
  });

  it('still returns 0 for identical points', () => {
    expect(_haversineKm(10, 20, 10, 20)).toBe(0);
  });
});

describe('matchEnRouteLoads coordinate handling', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ML_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ML_API_KEY = 'test-key';
    // Force the haversine fallback.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ML engine unreachable'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ML_API_KEY;
    else process.env.ML_API_KEY = originalKey;
  });

  it('keeps offers whose pickup is at 0,0', async () => {
    const result = await matchEnRouteLoads({
      currentLat: 0,
      currentLng: 0,
      maxDetourKm: 2000,
      offers: [
        {
          id: 'null-island',
          pickup_lat: 0,
          pickup_lng: 0,
          drop_lat: 0,
          drop_lng: 0,
          weight: '3 tonnes',
        },
      ],
    });

    expect(result.map((r) => r.id)).toEqual(['null-island']);
    expect(result[0].detour_km).toBe(0);
  });

  it('drops offers with out-of-range coordinates', async () => {
    const result = await matchEnRouteLoads({
      currentLat: 19.076,
      currentLng: 72.8777,
      maxDetourKm: 2000,
      offers: [
        { id: 'good', pickup_lat: 19.08, pickup_lng: 72.88, drop_lat: 28.6, drop_lng: 77.2, weight: '3 tonnes' },
        { id: 'bad-lat', pickup_lat: 999, pickup_lng: 72.88, drop_lat: 28.6, drop_lng: 77.2, weight: '3 tonnes' },
        { id: 'bad-lng', pickup_lat: 19.08, pickup_lng: 'abc', drop_lat: 28.6, drop_lng: 77.2, weight: '3 tonnes' },
        { id: 'bad-drop', pickup_lat: 19.08, pickup_lng: 72.88, drop_lat: 91, drop_lng: 77.2, weight: '3 tonnes' },
      ],
    });

    expect(result.map((r) => r.id)).toEqual(['good']);
  });

  it('falls back to the default detour budget when maxDetourKm is NaN', async () => {
    const result = await matchEnRouteLoads({
      currentLat: 12.9,
      currentLng: 77.5,
      maxDetourKm: NaN,
      offers: [
        { id: 'nearby', pickup_lat: 12.9, pickup_lng: 77.5, drop_lat: 13.0, drop_lng: 80.2, weight: '3 tonnes' },
      ],
    });

    // A NaN budget used to filter out every row and return an empty list.
    expect(result.map((r) => r.id)).toEqual(['nearby']);
  });

  it('falls back to the default detour budget when maxDetourKm is zero or negative', async () => {
    for (const maxDetourKm of [0, -10]) {
      const result = await matchEnRouteLoads({
        currentLat: 12.9,
        currentLng: 77.5,
        maxDetourKm,
        offers: [
          { id: 'nearby', pickup_lat: 12.9, pickup_lng: 77.5, drop_lat: 13.0, drop_lng: 80.2, weight: '3 tonnes' },
        ],
      });
      expect(result.map((r) => r.id), `maxDetourKm=${maxDetourKm}`).toEqual(['nearby']);
    }
  });

  it('never returns a NaN detour_km or match_score', async () => {
    const result = await matchEnRouteLoads({
      currentLat: 19.076,
      currentLng: 72.8777,
      maxDetourKm: 2000,
      offers: [
        { id: 'a', pickup_lat: '19.08', pickup_lng: '72.88', drop_lat: 28.6, drop_lng: 77.2, weight: '3 tonnes' },
      ],
    });

    expect(Number.isFinite(result[0].detour_km)).toBe(true);
    expect(Number.isFinite(result[0].match_score)).toBe(true);
  });
});
