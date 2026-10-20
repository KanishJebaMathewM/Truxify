import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({ redisClient: null }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }));
import { getLiveTrafficMultiplier, getTrafficForRoute } from '../../src/services/trafficService.js';

describe('documented TomTom flow-segment response', () => {
  beforeEach(() => {
    vi.stubEnv('TOMTOM_API_KEY', 'test-key');
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function multiplier(flowSegmentData) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ flowSegmentData }) }));
    return getLiveTrafficMultiplier(12.9, 77.6);
  }

  it('uses the provider example travel times to account for congestion', async () => {
    // TomTom Flow Segment Data documentation: 153 seconds versus 90 free-flow.
    expect(await multiplier({ currentSpeed: 41, freeFlowSpeed: 70, currentTravelTime: 153, freeFlowTravelTime: 90 })).toBe(1.7);
  });
  it('caps severe congestion at the existing maximum', async () => {
    expect(await multiplier({ currentTravelTime: 600, freeFlowTravelTime: 100 })).toBe(2.5);
  });
  it.each([100, 80])('retains baseline for equal or faster traffic (%i seconds)', async currentTravelTime => {
    expect(await multiplier({ currentTravelTime, freeFlowTravelTime: 100 })).toBe(1);
  });
  it.each([
    {}, { currentTravelTime: 120 }, { currentTravelTime: 120, freeFlowTravelTime: 0 },
    { currentTravelTime: -20, freeFlowTravelTime: 100 },
    { currentTravelTime: NaN, freeFlowTravelTime: 100 },
    { currentTravelTime: Infinity, freeFlowTravelTime: 100 },
    { currentTravelTime: 120, freeFlowTravelTime: '100' },
    { currentTravelTime: 120, freeFlowTravelTime: null },
  ])('returns a finite baseline for malformed flow data %j', async flow => {
    expect(await multiplier(flow)).toBe(1);
  });
  it('does not infer congestion from an undocumented percentage field', async () => {
    expect(await multiplier({ speedDiffPercent: -90 })).toBe(1);
  });
  it('uses documented travel times for route multiplier and segment delay', async () => {
    await multiplier({ currentTravelTime: 2700, freeFlowTravelTime: 1800 });
    const result = await getTrafficForRoute({ origin: [12, 77], destination: [13, 78] });
    expect(result).toMatchObject({ success: true, multiplier: 1.5, delayMinutes: 15, congestionLevel: 'moderate' });
  });
});
