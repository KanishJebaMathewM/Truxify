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
});
