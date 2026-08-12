import { vi, describe, it, expect, afterEach } from 'vitest';

describe('demand config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('uses default values when env vars are not set', async () => {
    delete process.env.DEMAND_BASE_EARNING_RATE;
    delete process.env.DEMAND_ROUTE_MULTIPLIER_BASE;
    delete process.env.DEMAND_PEAK_HOURS;
    const { demandConfig } = await import('../../src/config/demand.js?defaults');
    expect(demandConfig.baseEarningRate).toBe(18.5);
    expect(demandConfig.routeMultiplierBase).toBe(1.2);
    expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00']);
  });

  it('parses numeric env vars', async () => {
    process.env.DEMAND_BASE_EARNING_RATE = '25.75';
    process.env.DEMAND_ROUTE_MULTIPLIER_BASE = '1.5';
    const { demandConfig } = await import('../../src/config/demand.js?numeric');
    expect(demandConfig.baseEarningRate).toBe(25.75);
    expect(demandConfig.routeMultiplierBase).toBe(1.5);
  });

  it('falls back when numeric env var is invalid', async () => {
    process.env.DEMAND_BASE_EARNING_RATE = 'abc';
    const { demandConfig } = await import('../../src/config/demand.js?invalid');
    expect(demandConfig.baseEarningRate).toBe(18.5);
  });

  it('parses peak hours list from env', async () => {
    process.env.DEMAND_PEAK_HOURS = '06:00 - 08:00, 20:00 - 22:00';
    const { demandConfig } = await import('../../src/config/demand.js?list');
    expect(demandConfig.peakHours).toEqual(['06:00 - 08:00', '20:00 - 22:00']);
  });

  it('falls back when peak hours env is empty', async () => {
    process.env.DEMAND_PEAK_HOURS = '';
    const { demandConfig } = await import('../../src/config/demand.js?empty');
    expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00']);
  });

  it('returns fallback when peak hours env is whitespace-only', async () => {
    process.env.DEMAND_PEAK_HOURS = '   ';
    const { demandConfig } = await import('../../src/config/demand.js?ws');
    expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00']);
  });
});
