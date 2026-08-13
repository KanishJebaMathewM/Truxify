import { describe, it, expect } from 'vitest';
import { success, error } from '../../../src/utils/apiResponseHelpers.js';

describe('apiResponseHelpers', () => {
  describe('success', () => {
    it('returns success true with data', () => {
      const result = success({ foo: 'bar' });
      expect(result).toEqual({ success: true, data: { foo: 'bar' } });
    });

    it('returns success true with null data', () => {
      const result = success(null);
      expect(result).toEqual({ success: true, data: null });
    });

    it('returns success true with undefined data', () => {
      const result = success(undefined);
      expect(result).toEqual({ success: true, data: undefined });
    });

    it('includes meta when provided', () => {
      const result = success([1, 2, 3], { page: 1, limit: 10 });
      expect(result).toEqual({
        success: true,
        data: [1, 2, 3],
        meta: { page: 1, limit: 10 },
      });
    });

    it('omits meta when undefined', () => {
      const result = success({ id: 1 }, undefined);
      expect(result).not.toHaveProperty('meta');
    });

    it('includes meta when empty object is passed', () => {
      const result = success({ id: 2 }, {});
      expect(result).toHaveProperty('meta');
      expect(result.meta).toEqual({});
    });
  });

  describe('error', () => {
    it('returns success false with message', () => {
      const result = error('Something went wrong');
      expect(result).toEqual({ success: false, error: 'Something went wrong' });
    });

    it('includes code when provided', () => {
      const result = error('Not found', 'NOT_FOUND');
      expect(result).toEqual({
        success: false,
        error: 'Not found',
        code: 'NOT_FOUND',
      });
    });

    it('includes details when provided', () => {
      const result = error('Validation failed', 'VALIDATION_ERROR', { field: 'email' });
      expect(result).toEqual({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: { field: 'email' },
      });
    });

    it('omits code when undefined', () => {
      const result = error('Failed', undefined, { extra: true });
      expect(result).not.toHaveProperty('code');
      expect(result).toHaveProperty('details');
    });

    it('omits details when undefined', () => {
      const result = error('Error');
      expect(result).not.toHaveProperty('code');
      expect(result).not.toHaveProperty('details');
    });
  });
});
