import { describe, it, expect, vi, beforeEach } from 'vitest';
import hppProtection from '../../src/middleware/hppProtection.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let logger;

beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});

function makeReq(query = {}) {
  return {
    query,
    ip: '127.0.0.1',
    originalUrl: '/api/test',
    requestId: 'req-123',
  };
}

function makeRes() {
  return {
    on: vi.fn(),
  };
}

describe('hppProtection', () => {
  it('leaves single-value query params unchanged', () => {
    const req = makeReq({ page: '1', limit: '10' });
    const res = makeRes();
    const next = vi.fn();
    hppProtection(req, res, next);
    expect(req.query).toEqual({ page: '1', limit: '10' });
    expect(next).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('collapses array query params to the first value', () => {
    const req = makeReq({ page: ['2', '3', '4'] });
    const res = makeRes();
    const next = vi.fn();
    hppProtection(req, res, next);
    expect(req.query.page).toBe('2');
    expect(Array.isArray(req.query.page)).toBe(false);
  });

  it('logs a warning when duplicate params are detected', () => {
    const req = makeReq({ ids: ['1', '2', '3'] });
    const res = makeRes();
    const next = vi.fn();
    hppProtection(req, res, next);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-123',
        ip: '127.0.0.1',
        path: '/api/test',
        duplicateParams: ['ids'],
      }),
      'Potential HTTP Parameter Pollution detected'
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('collapses multiple duplicate params and reports all in warning', () => {
    const req = makeReq({ a: ['x', 'y'], b: ['p', 'q'] });
    const res = makeRes();
    const next = vi.fn();
    hppProtection(req, res, next);
    expect(req.query.a).toBe('x');
    expect(req.query.b).toBe('p');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicateParams: expect.arrayContaining(['a', 'b']),
      }),
      'Potential HTTP Parameter Pollution detected'
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('passes through to next() after processing', () => {
    const req = makeReq({ q: ['search'] });
    const res = makeRes();
    const next = vi.fn();
    hppProtection(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('handles empty query object', () => {
    const req = makeReq({});
    const res = makeRes();
    const next = vi.fn();
    hppProtection(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
