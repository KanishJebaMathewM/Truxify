import { describe, expect, it, vi } from 'vitest';

// notificationService is on the coldChain import chain; on main it carries
// top-level splice residue (fixed by #18290) — mock it so this suite is
// independent of that repair.
vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn(),
}));

import { calculateMeanKineticTemperature } from '../../src/services/coldChainAnomalyService.js';

// MKT (mean kinetic temperature) weights excursions exponentially — a single
// hot spike must raise the MKT far more than the arithmetic mean suggests.
describe('calculateMeanKineticTemperature', () => {
  it('constant temperature → MKT equals that temperature', () => {
    expect(calculateMeanKineticTemperature([4, 4, 4, 4])).toBeCloseTo(4, 1);
  });

  it('a hot excursion skews MKT well above the arithmetic mean', () => {
    const temps = [4, 4, 4, 4, 25]; // one-hour 25°C spike in a 4°C cold chain
    const arithmetic = temps.reduce((a, b) => a + b) / temps.length; // 8.2
    const mkt = calculateMeanKineticTemperature(temps);
    expect(mkt).toBeGreaterThan(arithmetic);
  });

  it('is symmetric to ordering (sequence-independent)', () => {
    const a = calculateMeanKineticTemperature([2, 8, 5]);
    const b = calculateMeanKineticTemperature([8, 2, 5]);
    expect(a).toBeCloseTo(b, 6);
  });

  it('handles sub-zero Celsius (frozen chain)', () => {
    const mkt = calculateMeanKineticTemperature([-18, -18, -15]);
    expect(mkt).toBeLessThan(-15);
    expect(mkt).toBeGreaterThan(-18.5);
  });

  it('skips non-finite readings and nulls on empty/garbage input', () => {
    expect(calculateMeanKineticTemperature([4, NaN, Infinity, 4])).toBeCloseTo(4, 1);
    expect(calculateMeanKineticTemperature([])).toBeNull();
    expect(calculateMeanKineticTemperature(null)).toBeNull();
    expect(calculateMeanKineticTemperature('junk')).toBeNull();
    expect(calculateMeanKineticTemperature([NaN, NaN])).toBeNull();
  });

  it('result is rounded to 2 decimals', () => {
    const mkt = calculateMeanKineticTemperature([3.333, 6.666]);
    expect(Number.isInteger(mkt * 100)).toBe(true);
  });
});
