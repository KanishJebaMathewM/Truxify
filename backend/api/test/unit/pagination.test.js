import { describe, it, expect, vi } from 'vitest';
import { validatePagination } from '../../src/middleware/pagination.js';

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
