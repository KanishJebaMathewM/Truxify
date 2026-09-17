import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

process.env.SUPABASE_URL = 'http://localhost:54321';
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
      wearPercentage: 0,
      remainingKm: 80000,
      needsReplacement: false,
      message: 'No trip data available for prediction.',
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

    expect(result.wearPercentage).toBe(1.25);
    expect(result.remainingKm).toBe(79000);
    expect(result.needsReplacement).toBe(false);
    expect(result.message).toBe('Tires are in acceptable condition.');
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

    expect(result.wearPercentage).toBe(31.5);
    expect(result.remainingKm).toBe(54800);
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

    expect(result.wearPercentage).toBe(87.5);
    expect(result.remainingKm).toBe(10000);
    expect(result.needsReplacement).toBe(true);
    expect(result.message).toBe('Warning: Tires need replacement soon.');
  });

  it('throws wrapped error when database query fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Postgres connection lost' }),
      text: async () => JSON.stringify({ message: 'Postgres connection lost' }),
    });

    await expect(calculateTireWear('driver-err')).rejects.toThrow(
      'Failed to calculate tire wear analytics.'
    );
  });
});
