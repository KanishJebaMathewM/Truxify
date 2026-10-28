import { describe, it, expect } from 'vitest';
import { filterCoordinatesByRadius } from '../../../src/utils/coordinates.js';

describe('filterCoordinatesByRadius safe validation', () => {
  const candidates = [
    { id: 1, lat: 12.9716, lng: 77.5946 },
    { id: 2, lat: 13.0827, lng: 80.2707 },
  ];

  it('returns empty array when center is null or undefined without throwing', () => {
    expect(filterCoordinatesByRadius(candidates, null, 50)).toEqual([]);
    expect(filterCoordinatesByRadius(candidates, undefined, 50)).toEqual([]);
  });

  it('returns empty stats object when opts.includeStats is true and center is invalid', () => {
    const res = filterCoordinatesByRadius(candidates, null, 50, { includeStats: true });
    expect(res.matches).toEqual([]);
    expect(res.stats.total).toBe(2);
    expect(res.stats.matches).toBe(0);
  });

  it('handles invalid coordinate types gracefully', () => {
    expect(filterCoordinatesByRadius(candidates, { lat: 'invalid', lng: 77.5 }, 50)).toEqual([]);
    expect(filterCoordinatesByRadius(candidates, { lat: 12.9, lng: NaN }, 50)).toEqual([]);
    expect(filterCoordinatesByRadius(candidates, { lat: 12.9, lng: 77.5 }, -10)).toEqual([]);
  });

  it('filters coordinates correctly with valid center lat/lng', () => {
    const res = filterCoordinatesByRadius(candidates, { lat: 12.9716, lng: 77.5946 }, 10);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe(1);
  });

  it('supports latitude/longitude aliases for center', () => {
    const res = filterCoordinatesByRadius(candidates, { latitude: 12.9716, longitude: 77.5946 }, 10);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe(1);
  });
});
