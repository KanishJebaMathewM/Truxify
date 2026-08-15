import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

// demand.js reads env vars at module load time, so we must re-import per test
async function reloadDemandConfig(envOverrides = {}) {
  // Clear module cache and reset env
  const savedEnv = { ...process.env };
  Object.keys(envOverrides).forEach((k) => {
    if (envOverrides[k] === null) delete process.env[k];
    else process.env[k] = envOverrides[k];
  });

  // Clear demandConfig from module cache
  vi.resetModules();

  const { demandConfig } = await import('../../src/config/demand.js');
  process.env = savedEnv;
  return { demandConfig };
}

describe('demandConfig', () => {
  it('exports baseEarningRate as a finite number', async () => {
    const { demandConfig } = await reloadDemandConfig({});
    expect(typeof demandConfig.baseEarningRate).toBe('number');
    expect(Number.isFinite(demandConfig.baseEarningRate)).toBe(true);
  });

  it('exports routeMultiplierBase as a finite number', async () => {
    const { demandConfig } = await reloadDemandConfig({});
    expect(typeof demandConfig.routeMultiplierBase).toBe('number');
    expect(Number.isFinite(demandConfig.routeMultiplierBase)).toBe(true);
  });

  it('exports routeMultiplierStep as a finite number', async () => {
    const { demandConfig } = await reloadDemandConfig({});
    expect(typeof demandConfig.routeMultiplierStep).toBe('number');
    expect(Number.isFinite(demandConfig.routeMultiplierStep)).toBe(true);
  });

  it('exports next24HoursFactor as a finite number', async () => {
    const { demandConfig } = await reloadDemandConfig({});
    expect(typeof demandConfig.next24HoursFactor).toBe('number');
    expect(Number.isFinite(demandConfig.next24HoursFactor)).toBe(true);
  });

  it('exports next48HoursFactor as a finite number', async () => {
    const { demandConfig } = await reloadDemandConfig({});
    expect(typeof demandConfig.next48HoursFactor).toBe('number');
    expect(Number.isFinite(demandConfig.next48HoursFactor)).toBe(true);
  });

  it('exports peakHours as a non-empty array', async () => {
    const { demandConfig } = await reloadDemandConfig({});
    expect(Array.isArray(demandConfig.peakHours)).toBe(true);
    expect(demandConfig.peakHours.length).toBeGreaterThan(0);
  });

  it('uses default baseEarningRate when env var is unset', async () => {
    const { demandConfig } = await reloadDemandConfig({
      DEMAND_BASE_EARNING_RATE: undefined,
    });
    expect(demandConfig.baseEarningRate).toBe(18.50);
  });

  it('uses env value for baseEarningRate when valid', async () => {
    const { demandConfig } = await reloadDemandConfig({
      DEMAND_BASE_EARNING_RATE: '25.00',
    });
    expect(demandConfig.baseEarningRate).toBe(25);
  });

  it('falls back for invalid baseEarningRate (non-numeric)', async () => {
    const { demandConfig } = await reloadDemandConfig({
      DEMAND_BASE_EARNING_RATE: 'not-a-number',
    });
    expect(demandConfig.baseEarningRate).toBe(18.50); // default fallback
  });

  it('falls back for NaN baseEarningRate', async () => {
    const { demandConfig } = await reloadDemandConfig({
      DEMAND_BASE_EARNING_RATE: 'NaN',
    });
    expect(demandConfig.baseEarningRate).toBe(18.50); // default fallback
  });

  it('uses env value for peakHours when valid', async () => {
    const { demandConfig } = await reloadDemandConfig({
      DEMAND_PEAK_HOURS: '06:00 - 08:00,18:00 - 20:00',
    });
    expect(demandConfig.peakHours).toEqual(['06:00 - 08:00', '18:00 - 20:00']);
  });

  it('uses default peakHours when env var is empty', async () => {
    const { demandConfig } = await reloadDemandConfig({
      DEMAND_PEAK_HOURS: '',
    });
    expect(demandConfig.peakHours).toEqual(['08:00 - 10:00', '17:00 - 19:00']);
  });
});
