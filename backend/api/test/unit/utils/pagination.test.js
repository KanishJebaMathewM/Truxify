import { describe, it, expect } from 'vitest';
import { buildPagination } from '../../../src/utils/pagination.js';

describe('buildPagination', () => {
  it('uses defaults when no params given', () => {
    const result = buildPagination();
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('calculates correct offset', () => {
    const result = buildPagination({ page: 3, limit: 10 });
    expect(result.offset).toBe(20);
    expect(result.from).toBe(20);
    expect(result.to).toBe(29);
  });

  it('enforces max limit of 100', () => {
    const result = buildPagination({ limit: 500 });
    expect(result.limit).toBe(100);
  });

  it('enforces minimum limit of 1', () => {
    const result = buildPagination({ limit: 0 });
    expect(result.limit).toBe(1);
  });

  it('floors non-integer page and limit', () => {
    const result = buildPagination({ page: 2.7, limit: 15.3 });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(15);
  });

  it('handles string numeric params', () => {
    const result = buildPagination({ page: '2', limit: '10' });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
  });

  it('returns defaults for invalid params', () => {
    const result = buildPagination({ page: 'abc', limit: 'xyz' });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });
});
