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

    it('handles negative page value', () => {
      const result = paginated([], -5, 10, 0);
      expect(result.pagination.page).toBe(-5);
      expect(result.pagination.hasNextPage).toBe(true);
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

    it('converts page and limit to numbers', () => {
      const result = paginated([], '2', '10', 30);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
    });
  });
});
