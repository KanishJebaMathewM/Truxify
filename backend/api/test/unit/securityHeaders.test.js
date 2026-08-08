/**
 * Unit tests for backend/api/src/middleware/securityHeaders.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import securityHeaders from '../../src/middleware/securityHeaders.js';

describe('securityHeaders middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      headers: {},
      getHeader: vi.fn((name) => mockRes.headers[name]),
      setHeader: vi.fn((name, value) => { mockRes.headers[name] = value; }),
    };
    mockNext = vi.fn();
  });

  it('sets X-Content-Type-Options to nosniff', () => {
    securityHeaders(mockReq, mockRes, mockNext);
    expect(mockRes.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sets X-Frame-Options to DENY', () => {
    securityHeaders(mockReq, mockRes, mockNext);
    expect(mockRes.headers['X-Frame-Options']).toBe('DENY');
  });

  it('calls next()', () => {
    securityHeaders(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('does not overwrite existing X-Content-Type-Options', () => {
    mockRes.headers['X-Content-Type-Options'] = 'already-set';
    securityHeaders(mockReq, mockRes, mockNext);
    expect(mockRes.headers['X-Content-Type-Options']).toBe('already-set');
  });
});
