import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Load demandConfig with a controlled set of env vars. demand.js reads
 * process.env at module load, so the module must be re-imported after the
 * env is changed; otherwise the tests silently exercise the cached defaults.
 */
async function loadDemandConfig(env = {}) {
  const keys = Object.keys(env);
  const saved = new Map();
  for (const key of keys) {
    saved.set(key, process.env[key]);
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    vi.resetModules();
    const { demandConfig } = await import('../../../src/config/demand.js');
    return demandConfig;
  } finally {
    for (const key of keys) {
      const prev = saved.get(key);
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

describe('demandConfig', () => {
  describe('default values when environment variables are unset', () => {
    it('returns expected default configuration values', async () => {
      const demandConfig = await loadDemandConfig({
        DEMAND_BASE_EARNING_RATE: undefined,
        DEMAND_ROUTE_MULTIPLIER_BASE: undefined,
        DEMAND_ROUTE_MULTIPLIER_STEP: undefined,
        DEMAND_NEXT_24H_FACTOR: undefined,
        DEMAND_NEXT_48H_FACTOR: undefined,
        DEMAND_PEAK_HOURS: undefined,
      });

      expect(demandConfig.baseEarningRate).toBe(18.50);
      expect(demandConfig.routeMultiplierBase).toBe(1.2);
      expect(demandConfig.routeMultiplierStep).toBe(0.1);
      expect(demandConfig.next24HoursFactor).toBe(1.1);
      expect(demandConfig.next48HoursFactor).toBe(0.95);
      expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00']);
    });
  });

  describe('environment variable overrides', () => {
    it('correctly applies custom numeric and list overrides from process.env', async () => {
      const demandConfig = await loadDemandConfig({
        DEMAND_BASE_EARNING_RATE: '22.75',
        DEMAND_ROUTE_MULTIPLIER_BASE: '1.5',
        DEMAND_ROUTE_MULTIPLIER_STEP: '0.25',
        DEMAND_NEXT_24H_FACTOR: '1.35',
        DEMAND_NEXT_48H_FACTOR: '0.85',
        DEMAND_PEAK_HOURS: '07:00 - 09:00, 12:00 - 14:00, 18:00 - 21:00',
      });

      expect(demandConfig.baseEarningRate).toBe(22.75);
      expect(demandConfig.routeMultiplierBase).toBe(1.5);
      expect(demandConfig.routeMultiplierStep).toBe(0.25);
      expect(demandConfig.next24HoursFactor).toBe(1.35);
      expect(demandConfig.next48HoursFactor).toBe(0.85);
      expect(demandConfig.peakHours).toEqual([
        '07:00 - 09:00',
        '12:00 - 14:00',
        '18:00 - 21:00',
      ]);
    });

    it('falls back to default when env values are invalid (non-numeric, NaN, or whitespace)', async () => {
      const demandConfig = await loadDemandConfig({
        DEMAND_BASE_EARNING_RATE: 'invalid-number',
        DEMAND_ROUTE_MULTIPLIER_BASE: '    ',
        DEMAND_ROUTE_MULTIPLIER_STEP: 'NaN',
        DEMAND_NEXT_24H_FACTOR: 'Infinity',
        DEMAND_NEXT_48H_FACTOR: '',
        DEMAND_PEAK_HOURS: '    ,   , ',
      });

      expect(demandConfig.baseEarningRate).toBe(18.50);
      expect(demandConfig.routeMultiplierBase).toBe(1.2);
      expect(demandConfig.routeMultiplierStep).toBe(0.1);
      expect(demandConfig.next24HoursFactor).toBe(1.1);
      expect(demandConfig.next48HoursFactor).toBe(0.95);
      expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00']);
    });
  });

  describe('demand calculation edge cases and formulas', () => {
    it('computes earning potential with standard multiplier', async () => {
      const demandConfig = await loadDemandConfig({});
      const multiplier = 0.5; // 50% surge
      const estimatedEarningPotential = Number((demandConfig.baseEarningRate * (1 + multiplier)).toFixed(2));
      expect(estimatedEarningPotential).toBe(27.75); // 18.50 * 1.5
    });

    it('handles zero demand multiplier without breaking', async () => {
      const demandConfig = await loadDemandConfig({});
      const multiplier = 0; // 0% surge
      const estimatedEarningPotential = Number((demandConfig.baseEarningRate * (1 + multiplier)).toFixed(2));
      expect(estimatedEarningPotential).toBe(18.50); // 18.50 * 1.0
    });

    it('handles negative demand multipliers gracefully', async () => {
      const demandConfig = await loadDemandConfig({});
      const multiplier = -0.2; // -20% dip in demand
      const estimatedEarningPotential = Number((demandConfig.baseEarningRate * (1 + multiplier)).toFixed(2));
      expect(estimatedEarningPotential).toBe(14.80); // 18.50 * 0.8
    });

    it('calculates 24-hour and 48-hour projected demand correctly', async () => {
      const demandConfig = await loadDemandConfig({});
      const multiplier = 0.6;
      const next24 = Number((multiplier * demandConfig.next24HoursFactor).toFixed(2));
      const next48 = Number((multiplier * demandConfig.next48HoursFactor).toFixed(2));

      expect(next24).toBe(0.66); // 0.6 * 1.1 = 0.66
      expect(next48).toBe(0.57); // 0.6 * 0.95 = 0.57
    });
  });

  describe('zone-based demand and route suggestion structure', () => {
    it('builds route suggestions with progressive step multipliers matching configuration', async () => {
      const demandConfig = await loadDemandConfig({});
      const estimatedEarningPotential = 20.0;

      const mockLoads = [
        { pickup_address: 'Zone A', drop_address: 'Zone B' },
        { pickup_address: 'Zone C', drop_address: 'Zone D' },
        { pickup_address: 'Zone E', drop_address: 'Zone F' },
      ];

      const routeSuggestions = mockLoads.map((load, idx) => ({
        id: idx + 1,
        recommendedRoute: `${load.pickup_address} -> ${load.drop_address}`,
        estimatedEarnings: Number(
          (estimatedEarningPotential * (demandConfig.routeMultiplierBase + idx * demandConfig.routeMultiplierStep)).toFixed(2)
        ),
      }));

      expect(routeSuggestions).toHaveLength(3);
      expect(routeSuggestions[0].estimatedEarnings).toBe(24.0); // 20 * 1.2
      expect(routeSuggestions[1].estimatedEarnings).toBe(26.0); // 20 * (1.2 + 0.1) = 20 * 1.3
      expect(routeSuggestions[2].estimatedEarnings).toBe(28.0); // 20 * (1.2 + 0.2) = 20 * 1.4
    });

    it('generates expected structure for predictedDemandNext48Hours object', async () => {
      const demandConfig = await loadDemandConfig({});
      const multiplier = 0.8;

      const predictedDemandNext48Hours = {
        next24Hours: Number((multiplier * demandConfig.next24HoursFactor).toFixed(2)),
        next48Hours: Number((multiplier * demandConfig.next48HoursFactor).toFixed(2)),
        peakHours: demandConfig.peakHours,
      };

      expect(predictedDemandNext48Hours).toEqual({
        next24Hours: 0.88,
        next48Hours: 0.76,
        peakHours: ['08:00 - 10:00', '17:00 - 19:00'],
      });
    });
  });
});
