import { describe, expect, it } from 'vitest';
import {
  MAX_TOLL_WAYPOINTS,
  estimateRouteTolls,
} from '../../src/services/tollService.js';

describe('tollService.estimateRouteTolls input validation', () => {
  it('accepts valid zero coordinates instead of treating them as missing', () => {
    const result = estimateRouteTolls({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0.01 }, 'LCV');
    expect(result.success).toBe(true);
    expect(result.vehicleClass).toBe('LCV');
    expect(result.totalPlazasCrossed).toBe(0);
  });

  it('rejects numeric strings rather than coercing them later', () => {
    expect(() =>
      estimateRouteTolls({ lat: '28.6', lng: 77.2 }, { lat: 29.2, lng: 77.1 }, 'LCV')
    ).toThrow(/finite lat and lng/);
  });

  it('rejects non-finite and out-of-range coordinates', () => {
    expect(() =>
      estimateRouteTolls({ lat: NaN, lng: 77.2 }, { lat: 29.2, lng: 77.1 }, 'LCV')
    ).toThrow(/finite lat and lng/);
    expect(() =>
      estimateRouteTolls({ lat: 28.6, lng: 77.2 }, { lat: 91, lng: 77.1 }, 'LCV')
    ).toThrow(/valid latitude\/longitude range/);
  });

  it('rejects a malformed waypoint before computing tolls', () => {
    expect(() =>
      estimateRouteTolls(
        { lat: 28.6, lng: 77.2 },
        { lat: 29.2, lng: 77.1 },
        'LCV',
        [{ lat: 'bad', lng: 77.0 }]
      )
    ).toThrow(/waypoints\[0\].*finite lat and lng/);
  });

  it('rejects a non-array waypoint collection', () => {
    expect(() =>
      estimateRouteTolls({ lat: 28.6, lng: 77.2 }, { lat: 29.2, lng: 77.1 }, 'LCV', 'nope')
    ).toThrow(/waypoints must be an array/);
  });

  it('caps the number of waypoints', () => {
    const waypoints = Array.from({ length: MAX_TOLL_WAYPOINTS + 1 }, () => ({ lat: 28.8, lng: 77.1 }));
    expect(() =>
      estimateRouteTolls({ lat: 28.6, lng: 77.2 }, { lat: 29.2, lng: 77.1 }, 'LCV', waypoints)
    ).toThrow(/at most 200 entries/);
  });

  it('rejects an unknown vehicle class instead of silently using the 2-axle rate', () => {
    expect(() =>
      estimateRouteTolls({ lat: 28.6, lng: 77.2 }, { lat: 29.2, lng: 77.1 }, 'SPACESHIP')
    ).toThrow(/Unknown vehicleClass/);
  });

  it('still detects a plaza on a valid route', () => {
    const result = estimateRouteTolls(
      { lat: 28.6139, lng: 77.209 },
      { lat: 29.2, lng: 77.1 },
      'LCV'
    );
    expect(result.plazas.map((plaza) => plaza.plazaId)).toContain('TP_NH44_MURTHAL');
    expect(result.vehicleClassDetails.id).toBe('LCV');
  });
});
