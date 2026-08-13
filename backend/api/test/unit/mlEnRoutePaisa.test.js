import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchEnRouteLoads } from '../../src/services/ml.js';

const mockLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

describe('matchEnRouteLoads monetary unit handling (#11546)', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ML_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ML_API_KEY = 'test-key';
    // Force the haversine fallback so earnings are computed locally.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ML engine unreachable'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ML_API_KEY;
    else process.env.ML_API_KEY = originalKey;
  });

  it('normalizes payment_inr (INR) to paisa in extra_earnings', async () => {
    const result = await matchEnRouteLoads({
      currentLat: 12.9,
      currentLng: 77.5,
      maxDetourKm: 2000,
      offers: [
        {
          id: 'load-inr',
          pickup_lat: 12.9,
          pickup_lng: 77.5,
          drop_lat: 13.0,
          drop_lng: 80.2,
          weight: '3 tonnes',
          payment_inr: 1000, // INR
          freight_value: null,
        },
      ],
    });

    expect(result[0].extra_earnings).toBe(1000 * 100); // 100000 paisa
  });

  it('keeps freight_value (paisa) as-is in extra_earnings', async () => {
    const result = await matchEnRouteLoads({
      currentLat: 12.9,
      currentLng: 77.5,
      maxDetourKm: 2000,
      offers: [
        {
          id: 'load-paisa',
          pickup_lat: 12.9,
          pickup_lng: 77.5,
          drop_lat: 13.0,
          drop_lng: 80.2,
          weight: '3 tonnes',
          payment_inr: null,
          freight_value: 250000, // paisa
        },
      ],
    });

    expect(result[0].extra_earnings).toBe(250000);
  });

  it('does not produce a 100x error when both fields are present', async () => {
    const result = await matchEnRouteLoads({
      currentLat: 12.9,
      currentLng: 77.5,
      maxDetourKm: 2000,
      offers: [
        {
          id: 'load-both',
          pickup_lat: 12.9,
          pickup_lng: 77.5,
          drop_lat: 13.0,
          drop_lng: 80.2,
          weight: '3 tonnes',
          payment_inr: 1000, // INR -> 100000 paisa
          freight_value: 250000, // paisa
        },
      ],
    });

    // payment_inr takes precedence and is normalized to paisa (no extra *100).
    expect(result[0].extra_earnings).toBe(100000);
    expect(result[0].extra_earnings).not.toBe(1000);
  });

  it('treats equivalent INR and paisa values as equal earnings', async () => {
    const inrResult = await matchEnRouteLoads({
      currentLat: 12.9,
      currentLng: 77.5,
      maxDetourKm: 2000,
      offers: [
        {
          id: 'a',
          pickup_lat: 12.9,
          pickup_lng: 77.5,
          drop_lat: 13.0,
          drop_lng: 80.2,
          weight: '3 tonnes',
          payment_inr: 1000, // INR
          freight_value: null,
        },
      ],
    });
    const paisaResult = await matchEnRouteLoads({
      currentLat: 12.9,
      currentLng: 77.5,
      maxDetourKm: 2000,
      offers: [
        {
          id: 'b',
          pickup_lat: 12.9,
          pickup_lng: 77.5,
          drop_lat: 13.0,
          drop_lng: 80.2,
          weight: '3 tonnes',
          payment_inr: null,
          freight_value: 100000, // paisa == 1000 INR
        },
      ],
    });

    expect(inrResult[0].extra_earnings).toBe(paisaResult[0].extra_earnings);
    expect(inrResult[0].extra_earnings).toBe(100000);
  });
});
