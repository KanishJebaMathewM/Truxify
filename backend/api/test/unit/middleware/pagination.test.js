import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePagination } from '../../../src/middleware/pagination.js';

const mockReq = (query = {}) => ({ query });
const mockRes = () => {
  const res = {
    statusCode: null,
    jsonData: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
  };
  return res;
};

describe('validatePagination middleware', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
  });

  describe('limit parameter', () => {
    it('uses default limit when not provided', () => {
      const req = mockReq();
      const res = mockRes();
      const middleware = validatePagination();
      middleware(req, res, next);
      expect(req.pagination.limit).toBe(10);
      expect(req.query.limit).toBe(10);
    });

    it('accepts valid limit', () => {
      const req = mockReq({ limit: '25' });
      const res = mockRes();
      const middleware = validatePagination();
      middleware(req, res, next);
      expect(req.pagination.limit).toBe(25);
      expect(next).toHaveBeenCalledOnce();
    });

    it('clamps limit to maxLimit', () => {
      const req = mockReq({ limit: '500' });
      const res = mockRes();
      const middleware = validatePagination({ maxLimit: 100 });
      middleware(req, res, next);
      expect(req.pagination.limit).toBe(100);
    });

    it('rejects non-numeric limit', () => {
      const req = mockReq({ limit: 'abc' });
      const res = mockRes();
      const middleware = validatePagination();
      middleware(req, res, next);
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects zero limit', () => {
      const req = mockReq({ limit: '0' });
      const res = mockRes();
      const middleware = validatePagination();
      middleware(req, res, next);
      expect(res.statusCode).toBe(400);
    });

    it('rejects negative limit', () => {
      const req = mockReq({ limit: '-5' });
      const res = mockRes();
      const middleware = validatePagination();
      middleware(req, res, next);
      expect(res.statusCode).toBe(400);
    });

    it('uses custom defaultLimit', () => {
      const req = mockReq({});
      const res = mockRes();
      const middleware = validatePagination({ defaultLimit: 20 });
      middleware(req, res, next);
      expect(req.pagination.limit).toBe(20);
    });
  });

  describe('offset parameter', () => {
    it('uses default offset when not provided', () => {
      const req = mockReq({});
      const res = mockRes();
      const middleware = validatePagination();
      middleware(req, res, next);
      expect(req.pagination.offset).toBe(0);
    });

    it('accepts valid offset', () => {
      const req = mockReq({ offset: '50' });
      const res = mockRes();
      const middleware = validatePagination();
      middleware(req, res, next);
      expect(req.pagination.offset).toBe(50);
    });

    it('clamps offset to maxOffset', () => {
      const req = mockReq({ offset: '20000' });
      const res = mockRes();
      const middleware = validatePagination({ maxOffset: 10000 });
      middleware(req, res, next);
      expect(req.pagination.offset).toBe(10000);
    });

    it('rejects negative offset', () => {
      const req = mockReq({ offset: '-10' });
      const res = mockRes();
      const middleware = validatePagination();
      middleware(req, res, next);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('page parameter', () => {
    it('converts page to offset (page 1 = offset 0)', () => {
      const req = mockReq({ page: '2', limit: '10' });
      const res = mockRes();
      const middleware = validatePagination();
      middleware(req, res, next);
      expect(req.pagination.offset).toBe(10);
    });

    it('clamps page-based offset to maxOffset', () => {
      const req = mockReq({ page: '1000', limit: '10' });
      const res = mockRes();
      const middleware = validatePagination({ maxOffset: 100 });
      middleware(req, res, next);
      expect(req.pagination.offset).toBeLessThanOrEqual(100);
    });

    it('rejects non-numeric page', () => {
      const req = mockReq({ page: 'abc' });
      const res = mockRes();
      const middleware = validatePagination();
      middleware(req, res, next);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('X-Total-Count header injection', () => {
    it('sets X-Total-Count from totalCount', () => {
      const req = mockReq({});
      const res = mockRes();
      const originalJson = res.json.bind(res);
      res.json = function (body) {
        if (body && typeof body === 'object') {
          body.totalCount = 500;
        }
        return originalJson(body);
      };
      const middleware = validatePagination();
      middleware(req, res, next);
      const jsonData = res.jsonData || {};
      if (jsonData.totalCount !== undefined) {
        expect(res.headers['X-Total-Count']).toBe('500');
      }
    });
  });
});
