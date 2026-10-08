import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), route: vi.fn() }));
vi.mock('../../src/config/db.js', () => ({ supabaseAdmin: { from: mocks.from }, supabase: null }));
vi.mock('../../src/services/osrm.js', () => ({ getRouteEstimate: mocks.route }));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import service from '../../src/services/order/deadheadMatchingService.js';

const offer = {
  id: 'offer-one', pickup_lat: 20, pickup_lng: 73, drop_lat: 21, drop_lng: 74,
  price: 10000, pickup_location: 'Pickup', drop_location: 'Drop',
};
const input = { driverId: 'driver-one', activeOrderId: 'order-one', currentLat: 19, currentLng: 72 };
function routes(baseline, legs) {
  mocks.route.mockResolvedValueOnce(baseline);
  for (const leg of legs) mocks.route.mockResolvedValueOnce(leg);
}

describe('mid-trip routing duration contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation(table => {
      const query = {
        select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: { id: 'order-one', drop_lat: 22, drop_lng: 75 } })),
        limit: vi.fn(async () => ({ data: table === 'load_offers' ? [offer] : [] })),
      };
      return query;
    });
  });

  it('rejects a short-distance insertion whose road travel time exceeds the limit', async () => {
    routes({ distanceKm: 100, durationSeconds: 3600 }, Array(3).fill({ distanceKm: 35, durationSeconds: 3000 }));
    const result = await service.findMidTripLoadOpportunities(input);
    expect(result.baselineRoute.durationMinutes).toBe(60);
    expect(result.opportunities).toEqual([]); // 150 - 60 = 90 minutes, over the default 60.
  });

  it('accepts a road-time-feasible insertion and uses that time in profit ranking', async () => {
    routes({ distanceKm: 100, durationSeconds: 3600 }, Array(3).fill({ distanceKm: 40, durationSeconds: 1500 }));
    const result = await service.findMidTripLoadOpportunities({ ...input, maxDetourMinutes: 20 });
    expect(result.opportunities).toHaveLength(1); // 75 - 60 = 15, not distance proxy's 30.
    expect(result.opportunities[0]).toMatchObject({ marginalDetourMinutes: 15, efficiencyScore: 647.33 });
  });

  it('retains a zero-second leg and falls back only for missing durations', async () => {
    routes({ distanceKm: 100, durationSeconds: 3600 }, [
      { distanceKm: 20, durationSeconds: 0 },
      { distanceKm: 40, durationSeconds: null },
      { distanceKm: 40, durationSeconds: 600 },
    ]);
    const result = await service.findMidTripLoadOpportunities(input);
    expect(result.opportunities[0].marginalDetourMinutes).toBe(10); // 0 + 60 + 10 - 60.
  });

  it('keeps the existing distance proxy when every road duration is absent', async () => {
    routes({ distanceKm: 100, durationSeconds: null }, Array(3).fill({ distanceKm: 40, durationSeconds: null }));
    const result = await service.findMidTripLoadOpportunities(input);
    expect(result.baselineRoute.durationMinutes).toBe(150);
    expect(result.opportunities[0].marginalDetourMinutes).toBe(30);
  });
});
