import { describe, it, expect } from 'vitest';
import { success, error, paginated } from '../../../src/lib/apiResponse.js';

describe('success', () => {
  it('returns a valid success response with defaults', () => {
    const result = success();
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.message).toBe('Success');
    expect(result.data).toBeNull();
  });

  it('accepts custom data, message, and statusCode', () => {
    const result = success({ id: 123 }, 'Created', 201);
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(201);
    expect(result.message).toBe('Created');
    expect(result.data).toEqual({ id: 123 });
  });

  it('handles null data explicitly', () => {
    const result = success(null, 'Empty');
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('handles array data', () => {
    const result = success([1, 2, 3], 'List');
    expect(result.data).toEqual([1, 2, 3]);
  });
});

describe('error', () => {
  it('returns a valid error response with defaults', () => {
    const result = error();
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.message).toBe('An error occurred');
  });

  it('accepts custom message and statusCode', () => {
    const result = error('Not Found', 404);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.message).toBe('Not Found');
  });

  it('includes errors field when provided', () => {
    const result = error('Validation failed', 400, ['field1 required', 'field2 invalid']);
    expect(result.errors).toEqual(['field1 required', 'field2 invalid']);
  });

  it('does not include errors field when null', () => {
    const result = error('Server error', 500, null);
    expect('errors' in result).toBe(false);
  });

  it('does not include errors field when undefined', () => {
    const result = error('Server error', 500, undefined);
    expect('errors' in result).toBe(false);
  });
});

describe('paginated', () => {
  it('returns a valid paginated response', () => {
    const result = paginated([{ id: 1 }], 1, 10, 25);
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.data).toEqual([{ id: 1 }]);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.total).toBe(25);
    expect(result.pagination.totalPages).toBe(3);
  });

  it('clamps limit to minimum of 1', () => {
    const result = paginated([], 1, 0, 0);
    expect(result.pagination.limit).toBe(1);
  });

  it('handles zero total', () => {
    const result = paginated([], 1, 10, 0);
    expect(result.pagination.totalPages).toBe(0);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPrevPage).toBe(false);
  });

  it('calculates hasPrevPage correctly', () => {
    const firstPage = paginated([], 1, 10, 25);
    expect(firstPage.pagination.hasPrevPage).toBe(false);

    const secondPage = paginated([], 2, 10, 25);
    expect(secondPage.pagination.hasPrevPage).toBe(true);
  });

  it('calculates hasNextPage correctly', () => {
    const lastPage = paginated([], 3, 10, 25);
    expect(lastPage.pagination.hasNextPage).toBe(false);

    const firstPage = paginated([], 1, 10, 25);
    expect(firstPage.pagination.hasNextPage).toBe(true);
  });

  it('coerces page and limit to numbers', () => {
    const result = paginated([], '2', '10', '25');
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.total).toBe(25);
  });
});
