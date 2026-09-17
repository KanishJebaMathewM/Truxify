import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { paginated } from '../../src/lib/apiResponse.js';

describe('apiResponse paginated', () => {
  let env;

  beforeEach(() => {
    env = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  it('returns correct structure with default params', () => {
    const result = paginated();
    expect(result.success).toBe(true);
    expect(result.message).toBe('Success');
    expect(result.data).toEqual([]);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPrevPage).toBe(false);
  });

  it('calculates hasNextPage correctly when more pages exist', () => {
    const result = paginated([1, 2, 3], 1, 10, 25);
    expect(result.pagination.totalPages).toBe(3);
    expect(result.pagination.hasNextPage).toBe(true);
    expect(result.pagination.hasPrevPage).toBe(false);
  });

  it('calculates hasPrevPage correctly on page 2', () => {
    const result = paginated([1, 2, 3], 2, 10, 25);
    expect(result.pagination.hasNextPage).toBe(true);
    expect(result.pagination.hasPrevPage).toBe(true);
  });

  it('hasNextPage is false on last page', () => {
    const result = paginated([1, 2, 3], 3, 10, 25);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPrevPage).toBe(true);
  });

  it('accepts custom message', () => {
    const result = paginated([1, 2], 1, 10, 2, 'Custom message');
    expect(result.message).toBe('Custom message');
  });

  it('calculates correctly with exact page boundary', () => {
    const result = paginated([1, 2, 3], 1, 3, 3);
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPrevPage).toBe(false);
  });

  it('handles non-numeric string inputs without producing NaN in pagination', () => {
    const result = paginated([1, 2], 'abc', 'xyz', 'foo');
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.pageSize).toBe(10);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPrevPage).toBe(false);
  });

  it('handles null values for page, limit, and total gracefully', () => {
    const result = paginated([1, 2], null, null, null);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.pageSize).toBe(10);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });

  it('caps limit at MAX_PAGE_SIZE (1000)', () => {
    const result = paginated([], 1, 5000, 10000);
    expect(result.pagination.limit).toBe(1000);
    expect(result.pagination.pageSize).toBe(1000);
    expect(result.pagination.totalPages).toBe(10);
  });

  it('guards against zero and negative limit by defaulting to 10', () => {
    const resultNegative = paginated([1, 2], 1, -20, 100);
    expect(resultNegative.pagination.limit).toBe(10);
    expect(resultNegative.pagination.pageSize).toBe(10);
    expect(resultNegative.pagination.totalPages).toBe(10);

    const resultZero = paginated([1, 2], 1, 0, 100);
    expect(resultZero.pagination.limit).toBe(10);
    expect(resultZero.pagination.pageSize).toBe(10);
    expect(resultZero.pagination.totalPages).toBe(10);
  });
});
