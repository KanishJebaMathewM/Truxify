import { describe, it, expect } from 'vitest';
import { success, error, paginated } from '../../src/lib/apiResponse.js';

describe('apiResponse helpers', () => {
  describe('success', () => {
    it('returns default success response', () => {
      const result = success('data');
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('Success');
      expect(result.data).toBe('data');
    });

    it('returns custom status code and message', () => {
      const result = success('data', 'Created', 201);
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(201);
      expect(result.message).toBe('Created');
    });

    it('returns null data when not provided', () => {
      const result = success();
      expect(result.data).toBe(null);
    });
  });

  describe('error', () => {
    it('returns default error response', () => {
      const result = error();
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    it('includes errors array when provided', () => {
      const result = error('Bad Request', 400, ['field1 required']);
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.errors).toEqual(['field1 required']);
    });

    it('omits errors when null', () => {
      const result = error('Server error', 500, null);
      expect(result.errors).toBeUndefined();
    });

    it('omits errors when undefined', () => {
      const result = error('Server error', 500, undefined);
      expect(result.errors).toBeUndefined();
    });
  });

  describe('paginated', () => {
    it('returns pagination metadata for page 1', () => {
      const result = paginated([1, 2, 3], 1, 10, 25);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasNextPage).toBe(true);
      expect(result.pagination.hasPrevPage).toBe(false);
    });

    it('clamps negative page values to 1', () => {
      const result = paginated([], -5, 10, 0);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.hasNextPage).toBe(false);
      expect(result.pagination.hasPrevPage).toBe(false);
    });

    it('handles total=0', () => {
      const result = paginated([], 1, 10, 0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNextPage).toBe(false);
      expect(result.pagination.hasPrevPage).toBe(false);
    });

    it('handles total less than limit', () => {
      const result = paginated(['a'], 1, 10, 5);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasNextPage).toBe(false);
      expect(result.pagination.hasPrevPage).toBe(false);
    });

    it('hasNextPage is true on penultimate page when total divides evenly by limit', () => {
      // total=30, limit=10: totalPages=3, page=2 is not last, hasNextPage should be true
      const result = paginated(['a'], 2, 10, 30);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasNextPage).toBe(true);
      expect(result.pagination.hasPrevPage).toBe(true);
    });

    it('converts numeric string page and limit to numbers', () => {
      const result = paginated([], '2', '10', 30);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
    });

    it('handles non-numeric string values gracefully with defaults', () => {
      const result = paginated([], 'abc', 'xyz', 'invalid');
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('handles null and undefined values gracefully with defaults', () => {
      const result = paginated([], null, null, null);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('handles NaN and Infinity values gracefully with defaults', () => {
      const result = paginated([], NaN, Infinity, -Infinity);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('handles empty string values gracefully with defaults', () => {
      const result = paginated([], '', '  ', '');
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('defaults to safe limit of 10 when limit is zero or negative', () => {
      const resultNegative = paginated([], 1, -5, 50);
      expect(resultNegative.pagination.limit).toBe(10);
      expect(resultNegative.pagination.pageSize).toBe(10);
      expect(resultNegative.pagination.totalPages).toBe(5);

      const resultZero = paginated([], 1, 0, 50);
      expect(resultZero.pagination.limit).toBe(10);
      expect(resultZero.pagination.pageSize).toBe(10);
      expect(resultZero.pagination.totalPages).toBe(5);

      const resultNegativeStr = paginated([], 1, '-10', 50);
      expect(resultNegativeStr.pagination.limit).toBe(10);
      expect(resultNegativeStr.pagination.pageSize).toBe(10);
      expect(resultNegativeStr.pagination.totalPages).toBe(5);
    });
  });
});

