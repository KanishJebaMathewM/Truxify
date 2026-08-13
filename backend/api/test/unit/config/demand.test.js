import { describe, it, expect, vi } from 'vitest';

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
  describe('baseEarningRate', () => {
    it('defaults to 18.50 when env not set', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_BASE_EARNING_RATE: undefined });
      expect(demandConfig.baseEarningRate).toBe(18.50);
    });

    it('parses a valid number from env', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_BASE_EARNING_RATE: '20.00' });
      expect(demandConfig.baseEarningRate).toBe(20.00);
    });

    it('falls back to default for invalid env value', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_BASE_EARNING_RATE: 'not-a-number' });
      expect(demandConfig.baseEarningRate).toBe(18.50);
    });

    it('falls back to default for empty string', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_BASE_EARNING_RATE: '' });
      expect(demandConfig.baseEarningRate).toBe(18.50);
    });
  });

  describe('routeMultiplierBase', () => {
    it('defaults to 1.2 when env not set', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_ROUTE_MULTIPLIER_BASE: undefined });
      expect(demandConfig.routeMultiplierBase).toBe(1.2);
    });

    it('falls back to default for NaN', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_ROUTE_MULTIPLIER_BASE: 'abc' });
      expect(demandConfig.routeMultiplierBase).toBe(1.2);
    });
  });

  describe('routeMultiplierStep', () => {
    it('defaults to 0.1 when env not set', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_ROUTE_MULTIPLIER_STEP: undefined });
      expect(demandConfig.routeMultiplierStep).toBe(0.1);
    });
  });

  describe('next24HoursFactor', () => {
    it('defaults to 1.1 when env not set', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_NEXT_24H_FACTOR: undefined });
      expect(demandConfig.next24HoursFactor).toBe(1.1);
    });
  });

  describe('next48HoursFactor', () => {
    it('defaults to 0.95 when env not set', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_NEXT_48H_FACTOR: undefined });
      expect(demandConfig.next48HoursFactor).toBe(0.95);
    });
  });

  describe('peakHours', () => {
    it('defaults to morning and evening rush hours', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_PEAK_HOURS: undefined });
      expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00']);
    });

    it('parses a comma-separated list from env', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_PEAK_HOURS: '09:00-11:00,18:00-20:00' });
      expect(demandConfig.peakHours).toEqual(['09:00-11:00', '18:00-20:00']);
    });

    it('returns default when env is empty string', async () => {
      const demandConfig = await loadDemandConfig({ DEMAND_PEAK_HOURS: '' });
      expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00']);
    });
  });
});
