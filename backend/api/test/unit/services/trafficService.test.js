import { describe, it, expect, vi, beforeEach } from 'vitest';
describe('trafficService', () => {
  beforeEach(() => vi.resetModules());
  it('module is importable', async () => {
    const mod = await import('../../../src/services/trafficService.js'); expect(mod).toBeDefined();
  });
  it('getLiveTrafficMultiplier is a function', async () => {
    const { getLiveTrafficMultiplier } = await import('../../../src/services/trafficService.js');
    expect(typeof getLiveTrafficMultiplier).toBe('function');
  });
  it('returns 1.0 for null/zero coordinates', async () => {
    const { getLiveTrafficMultiplier } = await import('../../../src/services/trafficService.js');
    expect(await getLiveTrafficMultiplier(null,null)).toBe(1.0);
    expect(await getLiveTrafficMultiplier(0,0)).toBe(1.0);
  });
});
