import { describe, it, expect, vi } from 'vitest';
import {
  buildPagination,
  parsePage,
  parseLimit,
  calculatePagination,
  getPaginationMeta,
  formatPaginationMeta,
  paginateArray,
} from '../../src/utils/pagination.js';
import { validatePagination } from '../../src/middleware/pagination.js';

describe('Pagination Utilities (src/utils/pagination.js)', () => {
  describe('parsePage', () => {
    it('returns 1 for undefined or null', () => {
      expect(parsePage(undefined)).toBe(1);
      expect(parsePage(null)).toBe(1);
    });

    it('returns 1 for non-numeric string', () => {
      expect(parsePage('abc')).toBe(1);
      expect(parsePage('')).toBe(1);
    });

    it('returns 1 for zero', () => {
      expect(parsePage('0')).toBe(1);
      expect(parsePage(0)).toBe(1);
    });

    it('returns 1 for negative numbers', () => {
      expect(parsePage('-5')).toBe(1);
      expect(parsePage(-10)).toBe(1);
    });

    it('returns the floored integer for valid positive numbers', () => {
      expect(parsePage('7')).toBe(7);
      expect(parsePage(100)).toBe(100);
      expect(parsePage('3.9')).toBe(3);
    });
  });

  describe('parseLimit', () => {
    it('returns default 20 for undefined or null', () => {
      expect(parseLimit(undefined)).toBe(20);
      expect(parseLimit(null)).toBe(20);
    });

    it('returns default 20 for non-numeric string or invalid input', () => {
      expect(parseLimit('abc')).toBe(20);
      expect(parseLimit('')).toBe(20);
    });

    it('returns default 20 for zero and negative numbers', () => {
      expect(parseLimit('0')).toBe(20);
      expect(parseLimit('-5')).toBe(20);
      expect(parseLimit(-1)).toBe(20);
    });

    it('caps at max when limit exceeds maxLimit', () => {
      expect(parseLimit('500', 100)).toBe(100);
      expect(parseLimit(150, 50)).toBe(50);
      expect(parseLimit(500)).toBe(100);
    });

    it('returns valid limit values', () => {
      expect(parseLimit('50')).toBe(50);
      expect(parseLimit('25', 50)).toBe(25);
      expect(parseLimit(15.7)).toBe(15);
    });
  });

  describe('buildPagination - Offset Calculation & Guards', () => {
    it('returns defaults when no params provided or empty object', () => {
      expect(buildPagination()).toEqual({ page: 1, limit: 20, offset: 0, from: 0, to: 19 });
      expect(buildPagination({})).toEqual({ page: 1, limit: 20, offset: 0, from: 0, to: 19 });
    });

    it('calculates correct offset from page and limit', () => {
      const result = buildPagination({ page: 3, limit: 10 });
      expect(result).toEqual({ page: 3, limit: 10, offset: 20, from: 20, to: 29 });
    });

    it('calculates offset for page 1 correctly', () => {
      const result = buildPagination({ page: 1, limit: 25 });
      expect(result).toEqual({ page: 1, limit: 25, offset: 0, from: 0, to: 24 });
    });

    it('enforces maximum limit cap of 100 by default or custom maxLimit', () => {
      const result = buildPagination({ limit: 500 });
      expect(result.limit).toBe(100);

      const customMax = buildPagination({ limit: 50, maxLimit: 30 });
      expect(customMax.limit).toBe(30);
    });

    it('enforces minimum limit of 1 for non-positive or negative limits', () => {
      expect(buildPagination({ limit: 0 }).limit).toBe(1);
      expect(buildPagination({ limit: -10 }).limit).toBe(1);
    });

    it('guards against negative or zero page values', () => {
      expect(buildPagination({ page: 0 }).page).toBe(1);
      expect(buildPagination({ page: -5 }).page).toBe(1);
      expect(buildPagination({ page: -10 }).offset).toBe(0);
    });

    it('guards against negative explicit offset by resetting to 0', () => {
      const result = buildPagination({ offset: -50, limit: 10 });
      expect(result.offset).toBe(0);
      expect(result.page).toBe(1);
      expect(result.from).toBe(0);
      expect(result.to).toBe(9);
    });

    it('calculates page properly when positive explicit offset is provided', () => {
      const result = buildPagination({ offset: 30, limit: 10 });
      expect(result.offset).toBe(30);
      expect(result.page).toBe(4);
      expect(result.from).toBe(30);
      expect(result.to).toBe(39);
    });

    it('handles numeric string values', () => {
      const result = buildPagination({ page: '2', limit: '15' });
      expect(result).toEqual({ page: 2, limit: 15, offset: 15, from: 15, to: 29 });
    });

    it('falls back to defaults for malformed string values, NaN, and Infinity', () => {
      expect(buildPagination({ page: '2abc', limit: '15xyz' })).toEqual({
        page: 1,
        limit: 20,
        offset: 0,
        from: 0,
        to: 19,
      });
      expect(buildPagination({ page: NaN, limit: NaN })).toEqual({
        page: 1,
        limit: 20,
        offset: 0,
        from: 0,
        to: 19,
      });
      expect(buildPagination({ page: Infinity, limit: Infinity })).toEqual({
        page: 1,
        limit: 20,
        offset: 0,
        from: 0,
        to: 19,
      });
    });

    it('floors non-integer page, limit, and offset', () => {
      const result = buildPagination({ page: 3.7, limit: 10.9 });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
      expect(result.to).toBe(29);
    });
  });

  describe('calculatePagination & Page Boundary Cases', () => {
    it('handles empty dataset boundary case (total = 0)', () => {
      const result = calculatePagination({ total: 0, page: 1, limit: 20 });
      expect(result.total).toBe(0);
      expect(result.totalCount).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(result.isEmpty).toBe(true);
      expect(result.isFirstPage).toBe(true);
      expect(result.isLastPage).toBe(true);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPrevPage).toBe(false);
      expect(result.isOverflow).toBe(false);
    });

    it('handles first page boundary case (page = 1 with multiple pages available)', () => {
      const result = calculatePagination({ total: 55, page: 1, limit: 20 });
      expect(result.total).toBe(55);
      expect(result.totalPages).toBe(3);
      expect(result.page).toBe(1);
      expect(result.offset).toBe(0);
      expect(result.isFirstPage).toBe(true);
      expect(result.isLastPage).toBe(false);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPrevPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
      expect(result.isOverflow).toBe(false);
      expect(result.isEmpty).toBe(false);
    });

    it('handles middle page (page = 2 with previous and next pages)', () => {
      const result = calculatePagination({ total: 55, page: 2, limit: 20 });
      expect(result.page).toBe(2);
      expect(result.offset).toBe(20);
      expect(result.isFirstPage).toBe(false);
      expect(result.isLastPage).toBe(false);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPrevPage).toBe(true);
    });

    it('handles last page boundary case (page = totalPages)', () => {
      const result = calculatePagination({ total: 55, page: 3, limit: 20 });
      expect(result.page).toBe(3);
      expect(result.offset).toBe(40);
      expect(result.totalPages).toBe(3);
      expect(result.isFirstPage).toBe(false);
      expect(result.isLastPage).toBe(true);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPrevPage).toBe(true);
      expect(result.isOverflow).toBe(false);
    });

    it('handles exact boundary when total is an exact multiple of limit', () => {
      const result = calculatePagination({ total: 40, page: 2, limit: 20 });
      expect(result.totalPages).toBe(2);
      expect(result.isLastPage).toBe(true);
      expect(result.hasNextPage).toBe(false);
    });

    it('handles overflow offset handling (page beyond total pages)', () => {
      const result = calculatePagination({ total: 50, page: 10, limit: 20 });
      expect(result.page).toBe(10);
      expect(result.offset).toBe(180);
      expect(result.totalPages).toBe(3);
      expect(result.isOverflow).toBe(true);
      expect(result.isLastPage).toBe(true);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPrevPage).toBe(true);
    });

    it('handles invalid or negative total count gracefully', () => {
      expect(calculatePagination({ total: -10, page: 1 })).toMatchObject({
        total: 0,
        totalPages: 0,
        isEmpty: true,
      });
      expect(calculatePagination({ total: 'invalid', page: 1 })).toMatchObject({
        total: 0,
        totalPages: 0,
        isEmpty: true,
      });
    });

    it('getPaginationMeta returns the same metadata structure', () => {
      const meta = getPaginationMeta(100, 2, 25);
      expect(meta.totalPages).toBe(4);
      expect(meta.offset).toBe(25);
      expect(meta.hasNextPage).toBe(true);
      expect(meta.hasPrevPage).toBe(true);
      expect(meta.hasPreviousPage).toBe(true);
    });
  });

  describe('formatPaginationMeta', () => {
    it('handles first page correctly', () => {
      const meta = formatPaginationMeta(100, 1, 20);
      expect(meta).toEqual({
        page: 1,
        limit: 20,
        total: 100,
        totalPages: 5,
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });

    it('handles middle page correctly', () => {
      const meta = formatPaginationMeta(100, 3, 20);
      expect(meta).toEqual({
        page: 3,
        limit: 20,
        total: 100,
        totalPages: 5,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('handles empty dataset with total = 0', () => {
      const meta = formatPaginationMeta(0, 1, 20);
      expect(meta).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });
  });

  describe('paginateArray', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

    it('slices array accurately for first page', () => {
      const { data, pagination } = paginateArray(items, { page: 1, limit: 3 });
      expect(data).toEqual(['a', 'b', 'c']);
      expect(pagination.total).toBe(7);
      expect(pagination.totalPages).toBe(3);
      expect(pagination.hasNextPage).toBe(true);
    });

    it('slices array accurately for second page', () => {
      const { data, pagination } = paginateArray(items, { page: 2, limit: 3 });
      expect(data).toEqual(['d', 'e', 'f']);
      expect(pagination.hasNextPage).toBe(true);
      expect(pagination.hasPrevPage).toBe(true);
    });

    it('slices array accurately for last partial page', () => {
      const { data, pagination } = paginateArray(items, { page: 3, limit: 3 });
      expect(data).toEqual(['g']);
      expect(pagination.isLastPage).toBe(true);
      expect(pagination.hasNextPage).toBe(false);
    });

    it('returns empty array when page overflows dataset', () => {
      const { data, pagination } = paginateArray(items, { page: 10, limit: 3 });
      expect(data).toEqual([]);
      expect(pagination.isOverflow).toBe(true);
    });

    it('handles non-array inputs safely', () => {
      const { data, pagination } = paginateArray(null);
      expect(data).toEqual([]);
      expect(pagination.total).toBe(0);
      expect(pagination.isEmpty).toBe(true);
    });
  });

  describe('Pagination Middleware Integration', () => {
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

    it('returns 400 for invalid limit parameter', () => {
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
      expect(req.query.offset).toBe(40);
    });
  });
});
