import { describe, it, expect } from 'vitest';
import { validatePagination } from '../../src/lib/validatePagination.js';

describe('validatePagination', () => {
  it('accepts valid page and pageSize', () => {
    const result = validatePagination({ page: 2, pageSize: 50 });
    expect(result.error).toBeUndefined();
    expect(result.offset).toBe(50);
    expect(result.limit).toBe(50);
  });

  it('uses defaults when page/pageSize are omitted', () => {
    const result = validatePagination({});
    expect(result.error).toBeUndefined();
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('rejects page < 1', () => {
    expect(validatePagination({ page: 0 }).error).toBeTruthy();
    expect(validatePagination({ page: -1 }).error).toBeTruthy();
  });

  it('rejects non-numeric page (NaN)', () => {
    expect(validatePagination({ page: 'abc' }).error).toBeTruthy();
    expect(validatePagination({ page: null }).error).toBeTruthy();
    expect(validatePagination({ page: undefined }).error).toBeTruthy();
  });

  it('rejects pageSize > 200', () => {
    expect(validatePagination({ pageSize: 201 }).error).toBeTruthy();
  });

  it('accepts pageSize at maximum boundary (200)', () => {
    const result = validatePagination({ pageSize: 200 });
    expect(result.error).toBeUndefined();
  });

  it('rejects offset exceeding MAX_OFFSET', () => {
    const result = validatePagination({ page: 50001, pageSize: 50 });
    expect(result.error).toContain('MAX_OFFSET');
  });
});
