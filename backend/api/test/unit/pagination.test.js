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
