import { describe, it, expect } from 'vitest';
import { generateIftaReport, calculateDistanceMiles } from '../../src/services/iftaTax.js';

/**
 * IFTA output is a legal filing, so these tests assert two properties:
 * numbers in the report are always real numbers, and a report never invents a
 * figure it did not measure.
 */

/** Two points about 75 miles apart across northern California. */
const SF = { latitude: 37.7749, longitude: -122.4194, jurisdictionState: 'CA' };
const SAC = { latitude: 38.5816, longitude: -121.4944, jurisdictionState: 'CA' };

describe('calculateDistanceMiles', () => {
  it('returns 0 for identical points', () => {
    expect(calculateDistanceMiles(37, -122, 37, -122)).toBe(0);
  });

  it('computes a plausible great-circle distance', () => {
    const miles = calculateDistanceMiles(37.7749, -122.4194, 38.5816, -121.4944);
    expect(miles).toBeGreaterThan(70);
    expect(miles).toBeLessThan(80);
  });

  it('is symmetric', () => {
    const ab = calculateDistanceMiles(37.7749, -122.4194, 40.7128, -74.006);
    const ba = calculateDistanceMiles(40.7128, -74.006, 37.7749, -122.4194);
    expect(ab).toBe(ba);
  });

  // Number(null) === 0 and Number('') === 0, so unguarded coercion reads a
  // missing coordinate as a real position off the coast of Africa.
  it.each([
    ['null latitude', null, -122, 38, -121],
    ['undefined latitude', undefined, -122, 38, -121],
    ['blank latitude', '', -122, 38, -121],
    ['non-numeric latitude', 'abc', -122, 38, -121],
    ['null longitude', 37, null, 38, -121],
    ['blank longitude', 37, '  ', 38, -121],
    ['Infinity', Infinity, -122, 38, -121],
  ])('rejects %s instead of returning NaN', (_label, a, b, c, d) => {
    expect(() => calculateDistanceMiles(a, b, c, d)).toThrow(/finite number/);
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => calculateDistanceMiles(91, -122, 38, -121)).toThrow(/between -90 and 90/);
    expect(() => calculateDistanceMiles(37, -181, 38, -121)).toThrow(/between -180 and 180/);
  });

  it('accepts the exact range boundaries', () => {
    expect(() => calculateDistanceMiles(90, 180, -90, -180)).not.toThrow();
  });
});

describe('generateIftaReport', () => {
  it('aggregates mileage and fuel per jurisdiction', () => {
    const report = generateIftaReport({
      truckId: 'TRK-1',
      waypoints: [SF, SAC],
      fuelPurchases: [{ jurisdictionState: 'CA', gallons: 10, taxPaidUSD: 420 }]
    });

    expect(report.truckId).toBe('TRK-1');
    expect(report.period).toBe('Q3 2026');
    expect(report.jurisdictionBreakdown).toHaveLength(1);

    const [ca] = report.jurisdictionBreakdown;
    expect(ca.jurisdictionState).toBe('CA');
    expect(ca.totalMilesDriven).toBeGreaterThan(70);
    expect(ca.taxableGallonsPurchased).toBe(10);
    expect(ca.taxPaidUSD).toBe(420);
    expect(report.summary.fleetAverageMpg).toBeGreaterThan(0);
  });

  // The core bug: one bad waypoint made grandTotalMiles NaN, and the filed
  // report reported totalMilesDriven: NaN.
  it('never reports NaN for a partially invalid waypoint chain', () => {
    expect(() =>
      generateIftaReport({ truckId: 'TRK-1', waypoints: [SF, { ...SAC, latitude: null }] })
    ).toThrow(/Invalid GPS waypoint between index 0 and 1/);
  });

  it('rejects a waypoint whose coordinates are out of range', () => {
    expect(() =>
      generateIftaReport({ truckId: 'TRK-1', waypoints: [SF, { ...SAC, latitude: 999 }] })
    ).toThrow(/between -90 and 90/);
  });

  it('rejects non-object waypoints', () => {
    expect(() =>
      generateIftaReport({ truckId: 'TRK-1', waypoints: [SF, 'not-a-point'] })
    ).toThrow(/must be objects/);
  });

  // 'CA' and 'ca' are the same jurisdiction; splitting them splits the mileage
  // across two report lines.
  it('merges jurisdictions that differ only by case or padding', () => {
    const report = generateIftaReport({
      truckId: 'TRK-1',
      waypoints: [
        { ...SF, jurisdictionState: 'ca' },
        { ...SAC, jurisdictionState: ' CA ' }
      ]
    });

    expect(report.jurisdictionBreakdown).toHaveLength(1);
    expect(report.jurisdictionBreakdown[0].jurisdictionState).toBe('CA');
    expect(report.jurisdictionBreakdown[0].totalMilesDriven).toBeGreaterThan(70);
  });

  // With a plain object accumulator, '__proto__' is truthy, so the bucket was
  // never created and `+=` wrote onto Object.prototype for the whole process.
  it('does not pollute Object.prototype via a __proto__ jurisdiction', () => {
    const report = generateIftaReport({
      truckId: 'TRK-1',
      waypoints: [
        { ...SF, jurisdictionState: '__proto__' },
        { ...SAC, jurisdictionState: '__proto__' }
      ],
      fuelPurchases: [{ jurisdictionState: '__proto__', gallons: 5 }]
    });

    expect({}.totalMilesDriven).toBeUndefined();
    expect({}.taxableGallonsPurchased).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('totalMilesDriven');
    expect(Object.prototype).not.toHaveProperty('taxableGallonsPurchased');

    // The jurisdiction is also upper-cased, so the key lands on '__PROTO__'
    // rather than the magic '__proto__' key.
    const entry = report.jurisdictionBreakdown.find((e) => e.jurisdictionState === '__PROTO__');
    expect(entry).toBeDefined();
    expect(entry.totalMilesDriven).toBeGreaterThan(0);
    expect(entry.taxableGallonsPurchased).toBe(5);
  });

  // A leg is attributed to the jurisdiction it arrives in, so this chain yields
  // only the destination's jurisdiction. What matters is that an inherited
  // Object key does not hijack the accumulator or produce a non-finite total.
  it('is not confused by inherited Object keys used as jurisdictions', () => {
    const report = generateIftaReport({
      truckId: 'TRK-1',
      waypoints: [
        { ...SF, jurisdictionState: 'constructor' },
        { ...SAC, jurisdictionState: 'toString' }
      ]
    });

    expect(report.jurisdictionBreakdown.map((e) => e.jurisdictionState)).toEqual(['TOSTRING']);
    report.jurisdictionBreakdown.forEach((entry) => {
      expect(Number.isFinite(entry.totalMilesDriven)).toBe(true);
    });
  });

  it('rejects negative fuel amounts', () => {
    expect(() =>
      generateIftaReport({
        truckId: 'TRK-1',
        waypoints: [SF, SAC],
        fuelPurchases: [{ jurisdictionState: 'CA', gallons: -10 }]
      })
    ).toThrow(/gallons must not be negative/);

    expect(() =>
      generateIftaReport({
        truckId: 'TRK-1',
        waypoints: [SF, SAC],
        fuelPurchases: [{ jurisdictionState: 'CA', gallons: 10, taxPaidUSD: -1 }]
      })
    ).toThrow(/taxPaidUSD must not be negative/);
  });

  it('rejects non-finite fuel amounts', () => {
    expect(() =>
      generateIftaReport({
        truckId: 'TRK-1',
        waypoints: [SF, SAC],
        fuelPurchases: [{ jurisdictionState: 'CA', gallons: 'abc' }]
      })
    ).toThrow(/gallons must be a finite number/);
  });

  it('defaults missing fuel fields to zero', () => {
    const report = generateIftaReport({
      truckId: 'TRK-1',
      waypoints: [SF, SAC],
      fuelPurchases: [{ jurisdictionState: 'CA' }]
    });
    expect(report.jurisdictionBreakdown[0].taxableGallonsPurchased).toBe(0);
  });

  // The old code reported a hardcoded 6.5 MPG as though it had been measured.
  it('returns null MPG rather than a fabricated figure when no fuel was purchased', () => {
    const report = generateIftaReport({ truckId: 'TRK-1', waypoints: [SF, SAC] });

    expect(report.summary.fleetAverageMpg).toBeNull();
    expect(report.summary.totalMilesDriven).toBeGreaterThan(0);
    expect(report.summary.totalGallonsPurchased).toBe(0);
  });

  it('returns an empty breakdown for no input', () => {
    const report = generateIftaReport({ truckId: 'TRK-1' });
    expect(report.jurisdictionBreakdown).toEqual([]);
    expect(report.summary.totalMilesDriven).toBe(0);
    expect(report.summary.fleetAverageMpg).toBeNull();
  });

  it('falls back to UNKNOWN when a jurisdiction is absent', () => {
    const report = generateIftaReport({
      truckId: 'TRK-1',
      waypoints: [
        { latitude: 37, longitude: -122 },
        { latitude: 38, longitude: -121 }
      ]
    });
    expect(report.jurisdictionBreakdown[0].jurisdictionState).toBe('UNKNOWN');
  });

  it('sorts jurisdictions deterministically', () => {
    const report = generateIftaReport({
      truckId: 'TRK-1',
      waypoints: [SF, { ...SAC, jurisdictionState: 'AZ' }],
      fuelPurchases: [{ jurisdictionState: 'NV', gallons: 2 }]
    });
    // The SF -> SAC leg arrives in AZ, so CA gets no mileage of its own.
    expect(report.jurisdictionBreakdown.map((e) => e.jurisdictionState)).toEqual(['AZ', 'NV']);
    expect(report.jurisdictionBreakdown[1].taxableGallonsPurchased).toBe(2);
  });

  it('honours the requested period', () => {
    const report = generateIftaReport({ truckId: 'TRK-1', quarter: 'Q1', year: 2025 });
    expect(report.period).toBe('Q1 2025');
  });

  it.each([
    ['no params', undefined],
    ['empty object', {}],
    ['missing truckId', { waypoints: [] }],
    ['non-array waypoints', { truckId: 'TRK-1', waypoints: 'nope' }],
    ['non-array fuelPurchases', { truckId: 'TRK-1', waypoints: [], fuelPurchases: {} }],
    ['non-object fuel purchase', { truckId: 'TRK-1', waypoints: [], fuelPurchases: [null] }]
  ])('rejects %s', (_label, params) => {
    expect(() => generateIftaReport(params)).toThrow();
  });
});
