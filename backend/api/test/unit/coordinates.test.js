import { describe, it, expect } from 'vitest';
import { validateCoordinateRange } from '../../src/utils/coordinates.js';

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

import { haversineDistance } from '../../src/utils/coordinates.js';

describe('haversineDistance', () => {
  it('throws on non-finite coordinates', () => {
    expect(() => haversineDistance(NaN, 0, 0, 0)).toThrow(TypeError);
    expect(() => haversineDistance(0, Infinity, 0, 0)).toThrow(TypeError);
  });

  it('returns 0 for identical points', () => {
    expect(haversineDistance(40.7, -74.0, 40.7, -74.0)).toBe(0);
  });

  it('calculates expected distance in km', () => {
    const d = haversineDistance(12.9716, 77.5946, 13.0827, 80.2707, 'km');
    expect(d).toBeCloseTo(290.17, 1);
  });

  it('calculates expected distance in meters', () => {
    const d = haversineDistance(12.9716, 77.5946, 13.0827, 80.2707, 'meters');
    expect(d).toBeCloseTo(290172, -2);
  });
});
