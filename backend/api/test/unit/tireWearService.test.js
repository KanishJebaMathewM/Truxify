import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

const originalFetch = globalThis.fetch;

const { calculateTireWear } = await import('../../src/services/tireWearService.js');

describe('tireWearService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns default baseline values when no trip data is found', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-range': '0-0/0', 'content-type': 'application/json' }),
      json: async () => [],
      text: async () => '[]',
    });

    const result = await calculateTireWear('driver-no-trips');

    expect(result).toEqual({
      driverId: 'driver-no-trips',
      hasData: false,
      wearPercentage: 0,
      remainingKm: 80000,
      currentTreadDepthMm: 16,
      blowoutHazardScore: 0.01,
      needsReplacement: false,
      rotationRecommended: false,
      message: 'No operational trip history available for predictive prognostics.',
    });
  });

  it('calculates effective tire wear correctly under standard conditions', async () => {
    const mockTrips = [
      {
        distance_km: 1000,
        load_weight_kg: 0,
        road_condition: 'good',
        weather: 'clear',
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-range': '0-0/1', 'content-type': 'application/json' }),
      json: async () => mockTrips,
      text: async () => JSON.stringify(mockTrips),
    });

    const result = await calculateTireWear('driver-1');

    expect(result.wearPercentage).toBe(1.44);
    expect(result.remainingKm).toBe(78850);
    expect(result.needsReplacement).toBe(false);
    expect(result.message).toBe('STATUS OK: Fleet tires are operating within safe manufacturer wear envelopes.');
  });

  it('applies road condition and adverse weather multipliers accurately', async () => {
    const mockTrips = [
      {
        distance_km: 10000,
        load_weight_kg: 1000,
        road_condition: 'poor',
        weather: 'snow',
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-range': '0-0/1', 'content-type': 'application/json' }),
      json: async () => mockTrips,
      text: async () => JSON.stringify(mockTrips),
    });

    const result = await calculateTireWear('driver-snow');

    expect(result.wearPercentage).toBe(32.05);
    expect(result.remainingKm).toBe(54362.19);
    expect(result.needsReplacement).toBe(false);
  });

  it('flags replacement required when cumulative wear reaches 80%', async () => {
    const mockTrips = [
      {
        distance_km: 70000,
        load_weight_kg: 0,
        road_condition: 'good',
        weather: 'clear',
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-range': '0-0/1', 'content-type': 'application/json' }),
      json: async () => mockTrips,
      text: async () => JSON.stringify(mockTrips),
    });

    const result = await calculateTireWear('driver-heavy');

    expect(result.wearPercentage).toBe(100);
    expect(result.remainingKm).toBe(0);
    expect(result.needsReplacement).toBe(true);
    expect(result.message).toBe('CRITICAL ALERT: Tire tread depth has reached or breached legal safety thresholds. Immediate replacement required.');
  });

  it('falls back to the baseline when the database query fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Postgres connection lost' }),
      text: async () => JSON.stringify({ message: 'Postgres connection lost' }),
    });

    const result = await calculateTireWear('driver-err');

    expect(result.hasData).toBe(false);
    expect(result.wearPercentage).toBe(0);
    expect(result.needsReplacement).toBe(false);
  });
});
