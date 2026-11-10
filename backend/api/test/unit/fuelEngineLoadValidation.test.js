import { describe, expect, it, vi } from 'vitest';
import { FuelAdvisorService } from '../../src/services/fuelAdvisorService.js';

function setup(loads) {
  const db = { from: vi.fn(table => {
    const chain = { select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
      limit: () => table === 'trip_events'
        ? Promise.resolve({ data: loads.map(engineLoad => ({ metadata: { engineLoad } })), error: null }) : chain,
      maybeSingle: async () => ({ data: { id: table === 'orders' ? 'order-one' : 'trip-one' }, error: null }),
    };
    return chain;
  }) };
  const weatherService = { getWeatherForecast: vi.fn(async () => ({ temperature_c: -5, condition: 'snow' })) };
  return { service: new FuelAdvisorService({ supabase: db, weatherService }), db };
}

describe('fuel recommendations with invalid engine-load samples', () => {
  it.each([NaN, Infinity, -Infinity, -1, 101, 1e308])('excludes invalid percentage %s from a low-load average', async invalid => {
    const { service } = setup([40, invalid]);
    const result = await service.getFuelRecommendation('truck-one', 45, 73);
    expect(result.factors.average_engine_load_percent).toBe(40);
    expect(result.recommended_blend).toBe('B5');
  });
  it('does not lower a valid high-load average with a negative sample', async () => {
    const { service } = setup([80, -100]);
    const result = await service.getFuelRecommendation('truck-one', 45, 73);
    expect(result.factors.average_engine_load_percent).toBe(80);
    expect(result.recommended_blend).toBe('B20');
  });
  it('uses the existing 50-percent default when no valid samples remain', async () => {
    const { service } = setup([NaN, Infinity, -Infinity, -20, 120, null, undefined, '80']);
    const result = await service.getFuelRecommendation('truck-one', 45, 73);
    expect(result.factors.average_engine_load_percent).toBe(50);
    expect(result.recommended_blend).toBe('B5');
  });
  it.each([[0, 'B5'], [60, 'B20'], [100, 'B20']])('preserves valid percentage %s and its threshold behavior', async (load, blend) => {
    const { service } = setup([load]);
    const result = await service.getFuelRecommendation('truck-one', 45, 73);
    expect(result.factors.average_engine_load_percent).toBe(load);
    expect(result.recommended_blend).toBe(blend);
  });
  it('averages only valid fractional samples while preserving ignored non-numeric values', async () => {
    const { service } = setup([40.5, 50.5, null, undefined, '100', true]);
    const result = await service.getFuelRecommendation('truck-one', 45, 73);
    expect(result.factors.average_engine_load_percent).toBe(46);
  });
});
