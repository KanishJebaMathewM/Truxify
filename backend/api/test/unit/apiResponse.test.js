import { describe, it, expect } from 'vitest';
import { success, error, paginated } from '../../src/lib/apiResponse.js';

describe('apiResponse helpers', () => {
  describe('success()', () => {
    it('returns default success response structure', () => {
      const res = success();
      expect(res).toEqual({
        success: true,
        statusCode: 200,
        message: 'Success',
        data: null,
      });
    });

    it('returns custom data, message, and statusCode', () => {
      const payload = { id: 1, name: 'Item' };
      const res = success(payload, 'Item fetched', 201);
      expect(res).toEqual({
        success: true,
        statusCode: 201,
        message: 'Item fetched',
        data: payload,
      });
    });
  });

  describe('error()', () => {
    it('returns default error response structure', () => {
      const res = error();
      expect(res).toEqual({
        success: false,
        statusCode: 500,
        message: 'An error occurred',
      });
    });

    it('returns custom error message and status code', () => {
      const res = error('Unauthorized', 401);
      expect(res).toEqual({
        success: false,
        statusCode: 401,
        message: 'Unauthorized',
      });
    });

    it('includes error details when provided', () => {
      const errDetails = [{ field: 'email', message: 'Invalid email' }];
      const res = error('Validation Failed', 400, errDetails);
      expect(res).toEqual({
        success: false,
        statusCode: 400,
        message: 'Validation Failed',
        errors: errDetails,
      });
    });

    it('omits errors key when errors argument is null or undefined', () => {
      const resNull = error('Bad Request', 400, null);
      const resUndefined = error('Bad Request', 400, undefined);
      expect('errors' in resNull).toBe(false);
      expect('errors' in resUndefined).toBe(false);
    });
  });

  describe('paginated()', () => {
    it('formats paginated response with correct pagination metadata', () => {
      const items = [{ id: 1 }, { id: 2 }];
      const res = paginated(items, 1, 2, 5, 'Data retrieved');

      expect(res).toEqual({
        success: true,
        statusCode: 200,
        message: 'Data retrieved',
        data: items,
        pagination: {
          page: 1,
          limit: 2,
          total: 5,
          totalPages: 3,
          hasNextPage: true,
          hasPrevPage: false,
        },
      });
    });

    it('handles last page pagination metadata correctly', () => {
      const items = [{ id: 5 }];
      const res = paginated(items, 3, 2, 5);

      expect(res.pagination).toEqual({
        page: 3,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: false,
        hasPrevPage: true,
      });
    });

    it('handles empty results and zero total', () => {
      const res = paginated([], 1, 10, 0);

      expect(res.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      });
    });
  });


describe('paginated edge cases', () => {
  it('handles page 0 gracefully', () => {
    const result = paginated([{ id: 1 }], 0, 10, 1);
    expect(result.pagination.page).toBe(0);
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.hasPrevPage).toBe(false);
    expect(result.pagination.hasNextPage).toBe(false);
  });

  it('handles page greater than totalPages', () => {
    const result = paginated([], 100, 10, 50);
    expect(result.pagination.page).toBe(100);
    expect(result.pagination.totalPages).toBe(5);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPrevPage).toBe(true);
  });

  it('handles total=0 gracefully', () => {
    const result = paginated([], 1, 10, 0);
    expect(result.pagination.totalPages).toBe(0);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPrevPage).toBe(false);
  });
});

});
