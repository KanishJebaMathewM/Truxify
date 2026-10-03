import { describe, it, expect } from 'vitest';
import {
  validateCoordinateRange,
  haversineDistance,
  getBoundingBox,
  isWithinBoundingBox,
  filterCoordinatesByRadius,
} from '../../src/utils/coordinates.js';

describe('validateCoordinateRange', () => {
  describe('valid coordinates', () => {
    it('returns null for typical lat/lng pair', () => {
      expect(validateCoordinateRange(28.6139, 77.2090)).toBeNull();
    });

    it('returns null for negative coordinates', () => {
      expect(validateCoordinateRange(-33.8688, 151.2093)).toBeNull();
    });

    it('returns null at the lower boundary (lat=-90, lng=-180)', () => {
      expect(validateCoordinateRange(-90, -180)).toBeNull();
    });

    it('returns null at the upper boundary (lat=90, lng=180)', () => {
      expect(validateCoordinateRange(90, 180)).toBeNull();
    });

    it('returns null for decimal coordinates', () => {
      expect(validateCoordinateRange(51.5074, -0.1278)).toBeNull();
    });

    it('returns null for zero coordinates', () => {
      expect(validateCoordinateRange(0, 0)).toBeNull();
    });
  });

  describe('invalid latitude', () => {
    it('returns error message when lat is below -90', () => {
      const result = validateCoordinateRange(-91, 0);
      expect(result).toBeTruthy();
      expect(result).toContain('lat');
    });

    it('returns error message when lat is above 90', () => {
      const result = validateCoordinateRange(91, 0);
      expect(result).toBeTruthy();
      expect(result).toContain('lat');
    });

    it('returns error message when lat is far below range', () => {
      const result = validateCoordinateRange(-200, 0);
      expect(result).toBeTruthy();
    });

    it('returns error message when lat is far above range', () => {
      const result = validateCoordinateRange(200, 0);
      expect(result).toBeTruthy();
    });
  });

  describe('invalid longitude', () => {
    it('returns error message when lng is below -180', () => {
      const result = validateCoordinateRange(0, -181);
      expect(result).toBeTruthy();
      expect(result).toContain('lng');
    });

    it('returns error message when lng is above 180', () => {
      const result = validateCoordinateRange(0, 181);
      expect(result).toBeTruthy();
      expect(result).toContain('lng');
    });

    it('returns error message when lng is far below range', () => {
      const result = validateCoordinateRange(0, -500);
      expect(result).toBeTruthy();
    });

    it('returns error message when lng is far above range', () => {
      const result = validateCoordinateRange(0, 500);
      expect(result).toBeTruthy();
    });
  });

  describe('both lat and lng invalid', () => {
    it('returns lat error first when both are out of range', () => {
      const result = validateCoordinateRange(91, 181);
      expect(result).toBeTruthy();
      expect(result).toContain('lat');
    });
  });

  describe('error messages and axis isolation', () => {
    it('returns the exact latitude error for a value below the minimum', () => {
      expect(validateCoordinateRange(-90.000001, 0))
        .toBe('lat must be between -90 and 90');
    });

    it('returns the exact latitude error for a value above the maximum', () => {
      expect(validateCoordinateRange(90.000001, 0))
        .toBe('lat must be between -90 and 90');
    });

    it('returns the exact longitude error for a value below the minimum', () => {
      expect(validateCoordinateRange(0, -180.000001))
        .toBe('lng must be between -180 and 180');
    });

    it('returns the exact longitude error for a value above the maximum', () => {
      expect(validateCoordinateRange(0, 180.000001))
        .toBe('lng must be between -180 and 180');
    });

    it('reports latitude before longitude when both axes are invalid', () => {
      expect(validateCoordinateRange(-91, 181))
        .toBe('lat must be between -90 and 90');
    });

    it('does not report longitude for a valid longitude with invalid latitude', () => {
      expect(validateCoordinateRange(90.1, 180)).toContain('lat');
    });

    it('does not report latitude for a valid latitude with invalid longitude', () => {
      expect(validateCoordinateRange(90, 180.1)).toContain('lng');
    });
  });

  describe('representative geographic coordinates', () => {
    it.each([
      ["Equator and prime meridian", 0, 0],
      ["Northern and eastern hemisphere", 28.6139, 77.2090],
      ["Northern and western hemisphere", 51.5074, -0.1278],
      ["Southern and eastern hemisphere", -33.8688, 151.2093],
      ["Southern and western hemisphere", -33.4489, -70.6693],
      ["Northwest corner", 89.999999, -179.999999],
      ["Southeast corner", -89.999999, 179.999999],
    ])('accepts %s', (_label, lat, lng) => {
      expect(validateCoordinateRange(lat, lng)).toBeNull();
    });
  });

  describe('boundary-adjacent coordinates', () => {
    it.each([
      [-90, -179.999999],
      [-90, 179.999999],
      [90, -179.999999],
      [90, 179.999999],
      [-89.999999, -180],
      [-89.999999, 180],
      [89.999999, -180],
      [89.999999, 180],
    ])('accepts lat=%s and lng=%s', (lat, lng) => {
      expect(validateCoordinateRange(lat, lng)).toBeNull();
    });

    it.each([
      [-90.000001, 0],
      [90.000001, 0],
    ])('rejects latitude just outside the boundary: %s', (lat, lng) => {
      expect(validateCoordinateRange(lat, lng)).toBe('lat must be between -90 and 90');
    });

    it.each([
      [0, -180.000001],
      [0, 180.000001],
    ])('rejects longitude just outside the boundary: %s', (lat, lng) => {
      expect(validateCoordinateRange(lat, lng)).toBe('lng must be between -180 and 180');
    });
  });

  describe('validation matrix', () => {
    it.each([
      [0, 0, null],
      [-90, 0, null],
      [90, 0, null],
      [0, -180, null],
      [0, 180, null],
      [-91, 0, 'lat must be between -90 and 90'],
      [91, 0, 'lat must be between -90 and 90'],
      [0, -181, 'lng must be between -180 and 180'],
      [0, 181, 'lng must be between -180 and 180'],
      [-91, 181, 'lat must be between -90 and 90'],
    ])('returns %s for lat=%s and lng=%s', (lat, lng, expected) => {
      expect(validateCoordinateRange(lat, lng)).toBe(expected);
    });
  });
});

describe('haversineDistance', () => {
  it('calculates accurate distance between Delhi and Mumbai (~1150 km)', () => {
    // Delhi: 28.6139, 77.2090 | Mumbai: 19.0760, 72.8777
    const dist = haversineDistance(28.6139, 77.2090, 19.0760, 72.8777, 'km');
    expect(dist).toBeGreaterThan(1140);
    expect(dist).toBeLessThan(1160);
  });

  it('returns 0 for identical coordinates', () => {
    const dist = haversineDistance(28.6139, 77.2090, 28.6139, 77.2090);
    expect(dist).toBe(0);
  });

  it('converts distance to miles when unit is miles', () => {
    const distKm = haversineDistance(28.6139, 77.2090, 19.0760, 72.8777, 'km');
    const distMiles = haversineDistance(28.6139, 77.2090, 19.0760, 72.8777, 'miles');
    expect(distMiles).toBeCloseTo(distKm * 0.621371, 1);
  });
});

describe('getBoundingBox & isWithinBoundingBox', () => {
  it('creates a bounding box enclosing the target radius', () => {
    const box = getBoundingBox(28.6139, 77.2090, 10);
    expect(box.minLat).toBeLessThan(28.6139);
    expect(box.maxLat).toBeGreaterThan(28.6139);
    expect(box.minLng).toBeLessThan(77.2090);
    expect(box.maxLng).toBeGreaterThan(77.2090);
  });

  it('correctly classifies points inside vs outside the bounding box', () => {
    const box = getBoundingBox(28.6139, 77.2090, 10); // ~10km box

    // ~2km away -> inside
    expect(isWithinBoundingBox({ lat: 28.62, lng: 77.21 }, box)).toBe(true);

    // ~500km away (Mumbai) -> outside
    expect(isWithinBoundingBox({ lat: 19.076, lng: 72.8777 }, box)).toBe(false);
  });
});

describe('filterCoordinatesByRadius', () => {
  const center = { lat: 28.6139, lng: 77.2090 }; // Delhi Connaught Place

  const candidates = [
    { id: 'driver-1', lat: 28.6150, lng: 77.2100 }, // ~0.15 km away
    { id: 'driver-2', lat: 28.6300, lng: 77.2200 }, // ~2 km away
    { id: 'driver-3', lat: 28.7000, lng: 77.1000 }, // ~14 km away
    { id: 'driver-4', lat: 19.0760, lng: 72.8777 }, // Mumbai (~1150 km away)
    { id: 'driver-5', lat: 13.0827, lng: 80.2707 }, // Chennai (~1750 km away)
  ];

  it('filters candidates within 5km radius and attaches sorted distance', () => {
    const results = filterCoordinatesByRadius(candidates, center, 5);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('driver-1');
    expect(results[1].id).toBe('driver-2');
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });

  it('eliminates distant candidates via bounding box pre-filter and reports efficiency metrics', () => {
    const { matches, stats } = filterCoordinatesByRadius(candidates, center, 5, { includeStats: true });
    expect(matches).toHaveLength(2);
    expect(stats.total).toBe(5);
    expect(stats.passedBox).toBe(2);
    expect(stats.eliminatedByBox).toBe(3);
    expect(stats.efficiencyPercent).toBe(60);
  });

  it('returns empty array when no candidates match or array is empty', () => {
    expect(filterCoordinatesByRadius([], center, 5)).toEqual([]);
    const farResults = filterCoordinatesByRadius(candidates, center, 0.01);
    expect(farResults).toEqual([]);
  });
});

