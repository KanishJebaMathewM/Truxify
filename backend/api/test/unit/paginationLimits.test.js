import { describe, expect, it } from 'vitest';
import { buildPagination, parseLimit } from '../../src/utils/pagination.js';

describe('pagination defaults respect custom limits', () => {
  it.each([undefined, null, 'invalid', Infinity, NaN])(
    'caps the buildPagination fallback for %s',
    (limit) => {
      expect(buildPagination({ page: 2, limit, maxLimit: 5 })).toEqual({
        page: 2, limit: 5, offset: 5, from: 5, to: 9,
      });
    },
  );

  it.each([undefined, null, 'invalid', Infinity, NaN, 0, -1])(
    'caps the parseLimit fallback for %s',
    (limit) => {
      expect(parseLimit(limit, 5)).toBe(5);
    },
  );

  it.each([0, -5, 0.5, 5.9])('normalizes a finite maximum %s to a positive integer', (max) => {
    const expected = Math.max(1, Math.floor(max));
    expect(parseLimit(100, max)).toBe(expected);
    expect(parseLimit(undefined, max)).toBe(Math.min(20, expected));
  });

  it('preserves the default and valid explicit limit behavior', () => {
    expect(buildPagination()).toEqual({ page: 1, limit: 20, offset: 0, from: 0, to: 19 });
    expect(parseLimit(undefined)).toBe(20);
    expect(parseLimit(3, 5)).toBe(3);
    expect(buildPagination({ limit: 3, maxLimit: 5 }).limit).toBe(3);
  });
});
