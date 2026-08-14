import { describe, it, expect, vi, beforeEach } from 'vitest';
import hppProtection from '../../../src/middleware/hppProtection.js';

const mockReq = (query = {}) => ({
  query,
  requestId: 'req-123',
  ip: '127.0.0.1',
  originalUrl: '/api/test',
});
const mockRes = () => ({
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    this.jsonData = data;
    return this;
  },
});

describe('hppProtection middleware', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
  });

  it('always calls next() for non-duplicate parameters', () => {
    const req = mockReq({ name: 'Alice', age: '30' });
    const res = mockRes();
    hppProtection(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('normalizes duplicate parameters to the first value', () => {
    const req = mockReq({ tag: ['a', 'b', 'c'] });
    const res = mockRes();
    hppProtection(req, res, next);
    expect(req.query.tag).toBe('a');
    expect(next).toHaveBeenCalledOnce();
  });

  it('normalizes duplicate parameters even when allowDuplicates option exists', () => {
    // The default hppProtection does not take an options argument
    const req = mockReq({ id: ['1', '2'] });
    const res = mockRes();
    hppProtection(req, res, next);
    expect(req.query.id).toBe('1');
    expect(next).toHaveBeenCalledOnce();
  });

  it('handles empty query object', () => {
    const req = mockReq({});
    const res = mockRes();
    hppProtection(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('normalizes single-element array to scalar', () => {
    const req = mockReq({ single: ['only'] });
    const res = mockRes();
    hppProtection(req, res, next);
    expect(req.query.single).toBe('only');
    expect(next).toHaveBeenCalledOnce();
  });
});
