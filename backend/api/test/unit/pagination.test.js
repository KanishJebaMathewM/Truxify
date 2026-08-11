import { describe, it, expect } from 'vitest';

function parsePage(raw) {
  const p = parseInt(raw, 10);
  if (!Number.isFinite(p) || p < 1) return 1;
  return p;
}

function parseLimit(raw, max = 100) {
  const l = parseInt(raw, 10);
  if (!Number.isFinite(l) || l < 1) return 20;
  if (l > max) return max;
  return l;
}

describe('parsePage', () => {
  it('returns 1 for undefined', () => {
    expect(parsePage(undefined)).toBe(1);
  });

  it('returns 1 for non-numeric string', () => {
    expect(parsePage('abc')).toBe(1);
  });

  it('returns 1 for zero', () => {
    expect(parsePage('0')).toBe(1);
  });

  it('returns 1 for negative numbers', () => {
    expect(parsePage('-5')).toBe(1);
  });

  it('returns the number for valid positive integers', () => {
    expect(parsePage('7')).toBe(7);
    expect(parsePage('100')).toBe(100);
  });
});

describe('parseLimit', () => {
  it('returns default 20 for undefined', () => {
    expect(parseLimit(undefined)).toBe(20);
  });

  it('returns default 20 for non-numeric string', () => {
    expect(parseLimit('abc')).toBe(20);
  });

  it('returns default 20 for zero', () => {
    expect(parseLimit('0')).toBe(20);
  });

  it('returns default 20 for negative numbers', () => {
    expect(parseLimit('-5')).toBe(20);
  });

  it('caps at max when limit exceeds max', () => {
    expect(parseLimit('500', 100)).toBe(100);
  });

  it('returns the number for valid limits', () => {
    expect(parseLimit('50')).toBe(50);
    expect(parseLimit('25', 50)).toBe(25);
  });
});
import { describe, it, expect, vi } from 'vitest';
import { validatePagination } from '../../src/middleware/pagination.js';
import { buildPagination } from '../../src/utils/pagination.js';

describe('buildPagination', () => {
  it('returns defaults when no params provided', () => {
    const result = buildPagination();
    expect(result).toEqual({ page: 1, limit: 20, offset: 0, from: 0, to: 19 });
  });

  it('returns defaults when empty object provided', () => {
    const result = buildPagination({});
    expect(result).toEqual({ page: 1, limit: 20, offset: 0, from: 0, to: 19 });
  });

  it('uses provided page and limit', () => {
    const result = buildPagination({ page: 3, limit: 10 });
    expect(result).toEqual({ page: 3, limit: 10, offset: 20, from: 20, to: 29 });
  });

  it('caps limit to maxLimit (100)', () => {
    const result = buildPagination({ limit: 500 });
    expect(result.limit).toBe(100);
  });

  it('enforces minimum limit of 1', () => {
    const result = buildPagination({ limit: -5 });
    expect(result.limit).toBe(1);
  });

  it('enforces minimum page of 1', () => {
    const result = buildPagination({ page: 0 });
    expect(result.page).toBe(1);
  });

  it('handles negative page', () => {
    const result = buildPagination({ page: -3 });
    expect(result.page).toBe(1);
  });

  it('returns correct string pagination from string values', () => {
    const result = buildPagination({ page: '2', limit: '15' });
    expect(result).toEqual({ page: 2, limit: 15, offset: 15, from: 15, to: 29 });
  });

  it('falls back to defaults for malformed string values', () => {
    const result = buildPagination({ page: '2abc', limit: '15abc' });
    expect(result).toEqual({ page: 1, limit: 20, offset: 0, from: 0, to: 19 });
  });

  it('handles page 1 with no limit correctly', () => {
    const result = buildPagination({ page: 1 });
    expect(result).toEqual({ page: 1, limit: 20, offset: 0, from: 0, to: 19 });
  });

  it('floors non-integer page', () => {
    const result = buildPagination({ page: 3.7, limit: 10 });
    expect(result.page).toBe(3);
    expect(result.from).toBe(20);
    expect(result.to).toBe(29);
  });

  it('floors non-integer limit', () => {
    const result = buildPagination({ page: 1, limit: 15.9 });
    expect(result.limit).toBe(15);
    expect(result.to).toBe(14);
  });
});

describe('Pagination Middleware', () => {
  const mockResponse = () => {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };

  it('uses defaults when no query parameters are provided', () => {
    const middleware = validatePagination();
    const req = { query: {} };
    const res = mockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.limit).toBe(10);
    expect(req.query.offset).toBe(0);
    expect(req.pagination).toEqual({ limit: 10, offset: 0 });
  });

  it('caps limit to maxLimit (100 by default)', () => {
    const middleware = validatePagination();
    const req = { query: { limit: '1000000' } };
    const res = mockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.limit).toBe(100);
  });

  it('returns 400 for invalid limit', () => {
    const middleware = validatePagination();
    const req = { query: { limit: 'abc' } };
    const res = mockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid limit parameter' });
  });

  it('returns 400 for partially numeric limit values', () => {
    const middleware = validatePagination();
    const req = { query: { limit: '10abc' } };
    const res = mockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid limit parameter' });
  });

  it('calculates offset correctly from page parameter', () => {
    const middleware = validatePagination();
    const req = { query: { limit: '20', page: '3' } };
    const res = mockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.limit).toBe(20);
    expect(req.query.offset).toBe(40); // (3-1) * 20
  });
});

describe('pagination — NaN and edge case handling', () => {
  it('buildPagination handles NaN page by defaulting to 1', () => {
    const result = buildPagination({ page: NaN });
    expect(result.page).toBe(1);
    expect(result.offset).toBe(0);
  });

  it('buildPagination handles NaN limit by defaulting to 20', () => {
    const result = buildPagination({ limit: NaN });
    expect(result.limit).toBe(20);
  });

  it('buildPagination handles Infinity page by defaulting to 1', () => {
    const result = buildPagination({ page: Infinity });
    expect(result.page).toBe(1);
  });
});
