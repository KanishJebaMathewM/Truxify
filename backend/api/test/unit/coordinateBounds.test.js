import { describe, it, expect } from 'vitest';
import { validateCoordinate, validateCoordinateRange } from '../../src/utils/coordinates.js';

describe('coordinateBounds - validateCoordinate unit tests', () => {
  describe('valid coordinates', () => {
    it('accepts valid positive latitude and longitude', () => {
      const latRes = validateCoordinate(28.6139, 'lat', 'pickup_lat');
      expect(latRes.valid).toBe(true);
      expect(latRes.value).toBe(28.6139);

      const lngRes = validateCoordinate(77.2090, 'lng', 'pickup_lng');
      expect(lngRes.valid).toBe(true);
      expect(lngRes.value).toBe(77.2090);
    });

    it('accepts valid negative latitude and longitude', () => {
      const latRes = validateCoordinate(-33.8688, 'lat', 'pickup_lat');
      expect(latRes.valid).toBe(true);
      expect(latRes.value).toBe(-33.8688);

      const lngRes = validateCoordinate(-70.6693, 'lng', 'pickup_lng');
      expect(lngRes.valid).toBe(true);
      expect(lngRes.value).toBe(-70.6693);
    });

    it('accepts 0 for both lat and lng', () => {
      const latRes = validateCoordinate(0, 'lat', 'lat');
      expect(latRes.valid).toBe(true);
      expect(latRes.value).toBe(0);

      const lngRes = validateCoordinate(0, 'lng', 'lng');
      expect(lngRes.valid).toBe(true);
      expect(lngRes.value).toBe(0);
    });

    it('accepts string representation of 0', () => {
      expect(validateCoordinate('0', 'lat', 'lat')).toEqual({ valid: true, value: 0 });
      expect(validateCoordinate('0', 'lng', 'lng')).toEqual({ valid: true, value: 0 });
    });

    it('accepts exact lower and upper boundaries (-90, 90, -180, 180)', () => {
      expect(validateCoordinate(-90, 'lat', 'lat')).toEqual({ valid: true, value: -90 });
      expect(validateCoordinate(90, 'lat', 'lat')).toEqual({ valid: true, value: 90 });
      expect(validateCoordinate(-180, 'lng', 'lng')).toEqual({ valid: true, value: -180 });
      expect(validateCoordinate(180, 'lng', 'lng')).toEqual({ valid: true, value: 180 });
    });

    it('accepts numeric strings within bounds', () => {
      expect(validateCoordinate('45.5', 'lat', 'pickup_lat')).toEqual({ valid: true, value: 45.5 });
      expect(validateCoordinate('-122.6', 'lng', 'pickup_lng')).toEqual({ valid: true, value: -122.6 });
    });
  });

  describe('out-of-bounds coordinates', () => {
    it('rejects lat < -90', () => {
      const res1 = validateCoordinate(-90.0001, 'lat', 'pickup_lat');
      expect(res1.valid).toBe(false);
      expect(res1.error).toBe('pickup_lat must be between -90 and 90');

      const res2 = validateCoordinate(-95, 'lat', 'pickup_lat');
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain('pickup_lat');
    });

    it('rejects lat > 90', () => {
      const res1 = validateCoordinate(90.0001, 'lat', 'pickup_lat');
      expect(res1.valid).toBe(false);
      expect(res1.error).toBe('pickup_lat must be between -90 and 90');

      const res2 = validateCoordinate(95, 'lat', 'pickup_lat');
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain('pickup_lat');
    });

    it('rejects lng < -180', () => {
      const res1 = validateCoordinate(-180.0001, 'lng', 'drop_lng');
      expect(res1.valid).toBe(false);
      expect(res1.error).toBe('drop_lng must be between -180 and 180');

      const res2 = validateCoordinate(-200, 'lng', 'drop_lng');
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain('drop_lng');
    });

    it('rejects lng > 180', () => {
      const res1 = validateCoordinate(180.0001, 'lng', 'drop_lng');
      expect(res1.valid).toBe(false);
      expect(res1.error).toBe('drop_lng must be between -180 and 180');

      const res2 = validateCoordinate(200, 'lng', 'drop_lng');
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain('drop_lng');
    });
  });

  describe('type safety and missing values (Rule 3)', () => {
    it('rejects null and undefined', () => {
      const resNull = validateCoordinate(null, 'lat', 'pickup_lat');
      expect(resNull.valid).toBe(false);
      expect(resNull.error).toBe('pickup_lat is required');

      const resUndef = validateCoordinate(undefined, 'lng', 'pickup_lng');
      expect(resUndef.valid).toBe(false);
      expect(resUndef.error).toBe('pickup_lng is required');
    });

    it('rejects empty strings and whitespace strings', () => {
      const resEmpty = validateCoordinate('', 'lat', 'pickup_lat');
      expect(resEmpty.valid).toBe(false);
      expect(resEmpty.error).toBe('pickup_lat cannot be empty');

      const resWhitespace = validateCoordinate('   ', 'lng', 'pickup_lng');
      expect(resWhitespace.valid).toBe(false);
      expect(resWhitespace.error).toBe('pickup_lng cannot be empty');
    });

    it('rejects booleans', () => {
      const resTrue = validateCoordinate(true, 'lat', 'pickup_lat');
      expect(resTrue.valid).toBe(false);
      expect(resTrue.error).toBe('pickup_lat must be a valid number');

      const resFalse = validateCoordinate(false, 'lng', 'pickup_lng');
      expect(resFalse.valid).toBe(false);
      expect(resFalse.error).toBe('pickup_lng must be a valid number');
    });

    it('rejects arrays', () => {
      const resEmptyArr = validateCoordinate([], 'lat', 'pickup_lat');
      expect(resEmptyArr.valid).toBe(false);
      expect(resEmptyArr.error).toBe('pickup_lat must be a valid number');

      const resArr = validateCoordinate([12.5], 'lng', 'pickup_lng');
      expect(resArr.valid).toBe(false);
      expect(resArr.error).toBe('pickup_lng must be a valid number');
    });

    it('rejects objects', () => {
      const resObj = validateCoordinate({ lat: 10 }, 'lat', 'pickup_lat');
      expect(resObj.valid).toBe(false);
      expect(resObj.error).toBe('pickup_lat must be a valid number');
    });

    it('rejects non-numeric strings', () => {
      const resStr = validateCoordinate('invalid', 'lat', 'pickup_lat');
      expect(resStr.valid).toBe(false);
      expect(resStr.error).toBe('pickup_lat must be a finite number');
    });

    it('rejects NaN, Infinity, -Infinity', () => {
      expect(validateCoordinate(NaN, 'lat', 'pickup_lat').valid).toBe(false);
      expect(validateCoordinate(Infinity, 'lat', 'pickup_lat').valid).toBe(false);
      expect(validateCoordinate(-Infinity, 'lng', 'pickup_lng').valid).toBe(false);
    });
  });

  describe('validateCoordinateRange backwards compatibility & error messages', () => {
    it('returns null for valid coordinate pairs', () => {
      expect(validateCoordinateRange(28.6139, 77.2090)).toBeNull();
      expect(validateCoordinateRange(0, 0)).toBeNull();
      expect(validateCoordinateRange(-90, -180)).toBeNull();
      expect(validateCoordinateRange(90, 180)).toBeNull();
    });

    it('returns latitude error message when latitude is invalid', () => {
      expect(validateCoordinateRange(95, 77)).toBe('lat must be between -90 and 90');
      expect(validateCoordinateRange(-95, 77)).toBe('lat must be between -90 and 90');
    });

    it('returns longitude error message when longitude is invalid', () => {
      expect(validateCoordinateRange(28, 200)).toBe('lng must be between -180 and 180');
      expect(validateCoordinateRange(28, -200)).toBe('lng must be between -180 and 180');
    });

    it('prioritizes latitude error when both are invalid', () => {
      expect(validateCoordinateRange(95, 200)).toBe('lat must be between -90 and 90');
    });

    it('uses custom field names when provided', () => {
      expect(validateCoordinateRange(95, 77, 'pickup_lat', 'pickup_lng'))
        .toBe('pickup_lat must be between -90 and 90');
      expect(validateCoordinateRange(28, 200, 'pickup_lat', 'pickup_lng'))
        .toBe('pickup_lng must be between -180 and 180');
    });

    it('rejects null and empty values in validateCoordinateRange', () => {
      expect(validateCoordinateRange(null, 77)).toBe('lat is required');
      expect(validateCoordinateRange(28, null)).toBe('lng is required');
      expect(validateCoordinateRange('', 77)).toBe('lat cannot be empty');
      expect(validateCoordinateRange(28, true)).toBe('lng must be a valid number');
    });
  });
});
