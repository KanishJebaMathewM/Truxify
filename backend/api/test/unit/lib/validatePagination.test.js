import { describe, it, expect } from 'vitest';
import { validatePagination } from '../../../src/lib/validatePagination.js';

describe('validatePagination', () => {
  it('returns correct pagination for valid inputs', () => {
    const result = validatePagination({ page: 1, pageSize: 20 });
    expect(result).toEqual({ page: 1, pageSize: 20, offset: 0, limit: 20 });
  });

  it('returns correct offset for page 2', () => {
    const result = validatePagination({ page: 2, pageSize: 20 });
    expect(result).toEqual({ page: 2, pageSize: 20, offset: 20, limit: 20 });
  });

  it('returns correct offset for page 5 with 10 items per page', () => {
    const result = validatePagination({ page: 5, pageSize: 10 });
    expect(result).toEqual({ page: 5, pageSize: 10, offset: 40, limit: 10 });
  });

  it('handles string page and pageSize inputs', () => {
    const result = validatePagination({ page: '3', pageSize: '25' });
    expect(result).toEqual({ page: 3, pageSize: 25, offset: 50, limit: 25 });
  });

  it('handles undefined inputs with defaults', () => {
    const result = validatePagination({});
    expect(result).toEqual({ page: 1, pageSize: 20, offset: 0, limit: 20 });
  });

  it('handles null/undefined individual inputs', () => {
    const r1 = validatePagination({ page: null, pageSize: 20 });
    expect(r1.error).toBe('page must be >= 1');

    const r2 = validatePagination({ page: 1, pageSize: null });
    expect(r2.error).toBe('pageSize must be >= 1');
  });

  it('returns error for page less than 1', () => {
    const result = validatePagination({ page: 0, pageSize: 20 });
    expect(result.error).toBe('page must be >= 1');
  });

  it('returns error for page less than 1 (negative)', () => {
    const result = validatePagination({ page: -1, pageSize: 20 });
    expect(result.error).toBe('page must be >= 1');
  });

  it('returns error for pageSize less than 1', () => {
    const result = validatePagination({ page: 1, pageSize: 0 });
    expect(result.error).toBe('pageSize must be >= 1');
  });

  it('returns error for pageSize greater than 200', () => {
    const result = validatePagination({ page: 1, pageSize: 201 });
    expect(result.error).toBe('pageSize must be <= 200');
  });

  it('allows pageSize of 200', () => {
    const result = validatePagination({ page: 1, pageSize: 200 });
    expect(result).toEqual({ page: 1, pageSize: 200, offset: 0, limit: 200 });
  });

  it('returns error when offset exceeds MAX_OFFSET', () => {
    // (50001-1)*20 = 1000000 which equals MAX_OFFSET, not exceeds
    // (50002-1)*20 = 1000020 which exceeds MAX_OFFSET
    const result = validatePagination({ page: 50002, pageSize: 20 });
    expect(result.error).toContain('exceeds MAX_OFFSET');
    expect(result.status).toBe(400);
  });

  it('does not error at exactly MAX_OFFSET boundary', () => {
    // (50001-1)*20 = 1000000 which equals MAX_OFFSET
    const result = validatePagination({ page: 50001, pageSize: 20 });
    expect(result.error).toBeUndefined();
    expect(result.page).toBe(50001);
  });

  it('returns error for NaN page', () => {
    const result = validatePagination({ page: NaN, pageSize: 20 });
    expect(result.error).toBe('page must be >= 1');
  });

  it('returns error for NaN pageSize', () => {
    const result = validatePagination({ page: 1, pageSize: NaN });
    expect(result.error).toBe('pageSize must be >= 1');
  });

  it('returns error for non-numeric string page', () => {
    const result = validatePagination({ page: 'abc', pageSize: 20 });
    expect(result.error).toBe('page must be >= 1');
  });

  it('returns error for non-numeric string pageSize', () => {
    const result = validatePagination({ page: 1, pageSize: 'xyz' });
    expect(result.error).toBe('pageSize must be >= 1');
  });

  it('handles floating point page values (does not coerce to integer)', () => {
    // Number(2.7) = 2.7, and 2.7 < 1 is false, so it passes the >= 1 check
    const result = validatePagination({ page: 2.7, pageSize: 10 });
    // page 2.7 with pageSize 10 gives offset = (2.7-1)*10 = 17
    expect(result.error).toBeUndefined();
    expect(result.page).toBe(2.7);
    expect(result.offset).toBe(17);
  });
});
