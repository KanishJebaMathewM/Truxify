import { describe, it, expect } from 'vitest';
import { validatePagination } from '../../src/lib/validatePagination.js';

describe('validatePagination', () => {
  it('returns valid pagination for default values', () => {
    const result = validatePagination();
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(20);
    expect(result.error).toBeUndefined();
  });

  it('returns error for NaN page', () => {
    const result = validatePagination({ page: NaN });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('page');
  });

  it('returns error for negative page', () => {
    const result = validatePagination({ page: -1 });
    expect(result.error).toBeTruthy();
  });

  it('returns error for page=0', () => {
    const result = validatePagination({ page: 0 });
    expect(result.error).toBeTruthy();
  });

  it('returns error for pageSize > 200', () => {
    const result = validatePagination({ pageSize: 300 });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('pageSize');
  });

  it('returns error for pageSize <= 0', () => {
    expect(validatePagination({ pageSize: 0 }).error).toBeTruthy();
    expect(validatePagination({ pageSize: -5 }).error).toBeTruthy();
  });

  it('returns error when offset exceeds MAX_OFFSET', () => {
    const result = validatePagination({ page: 100001, pageSize: 20 });
    expect(result.error).toContain('MAX_OFFSET');
  });

  it('returns valid result for page=2', () => {
    const result = validatePagination({ page: 2, pageSize: 10 });
    expect(result.page).toBe(2);
    expect(result.offset).toBe(10);
    expect(result.error).toBeUndefined();
  });
});

describe('validatePagination - additional edge cases', () => {
  it('rejects NaN via Number() coercion', () => {
    expect(validatePagination({ page: NaN }).error).toBeTruthy();
    expect(validatePagination({ pageSize: NaN }).error).toBeTruthy();
  });

  it('rejects Infinity', () => {
    expect(validatePagination({ page: Infinity }).error).toBeTruthy();
    expect(validatePagination({ pageSize: Infinity }).error).toBeTruthy();
  });
});
