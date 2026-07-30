import { describe, it, expect, vi, beforeEach } from 'vitest';
import cacheControlVerifier from '../../src/middleware/cacheControlVerifier.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let logger;

beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    originalUrl: '/api/test',
    requestId: 'req-456',
    ...overrides,
  };
}

function makeRes(headers = {}) {
  return {
    getHeader: vi.fn((name) => {
      const key = Object.keys(headers).find(k => k.toLowerCase() === String(name).toLowerCase());
      return key ? headers[key] : undefined;
    }),
    setHeader: vi.fn(),
    on: vi.fn(),
  };
}

function emitFinish(res) {
  const listeners = {};
  res.on.mock.calls.forEach(([event, cb]) => {
    listeners[event] = cb;
  });
  listeners['finish']?.();
}

describe('cacheControlVerifier', () => {
  it('skips in production (calls next immediately)', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const req = makeReq({ user: { id: 'user-1' } });
      const res = makeRes({ 'cache-control': 'no-store' });
      const next = vi.fn();
      cacheControlVerifier(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('calls next without logging for unauthenticated requests (no req.user)', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const req = makeReq({ user: undefined });
      const res = makeRes({});
      const next = vi.fn();
      cacheControlVerifier(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('logs a warning when Cache-Control header is missing on authenticated responses', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const req = makeReq({ user: { id: 'user-1' } });
      const res = makeRes({ pragma: 'no-cache', expires: 'Thu, 01 Jan 2025 00:00:00 GMT' });
      const next = vi.fn();
      cacheControlVerifier(req, res, next);
      emitFinish(res);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/api/test',
          missingHeaders: expect.arrayContaining(['Cache-Control']),
        }),
        'Authenticated response may be cacheable'
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('logs a warning when Pragma header is missing', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const req = makeReq({ user: { id: 'user-1' } });
      const res = makeRes({ 'cache-control': 'no-store', expires: 'Thu, 01 Jan 2025 00:00:00 GMT' });
      const next = vi.fn();
      cacheControlVerifier(req, res, next);
      emitFinish(res);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          missingHeaders: expect.arrayContaining(['Pragma']),
        }),
        'Authenticated response may be cacheable'
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('logs a warning when Expires header is missing', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const req = makeReq({ user: { id: 'user-1' } });
      const res = makeRes({ 'cache-control': 'no-store', pragma: 'no-cache' });
      const next = vi.fn();
      cacheControlVerifier(req, res, next);
      emitFinish(res);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          missingHeaders: expect.arrayContaining(['Expires']),
        }),
        'Authenticated response may be cacheable'
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('does not log for responses with all expected cache-prevention headers', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const req = makeReq({ user: { id: 'user-1' } });
      const res = makeRes({
        'cache-control': 'no-store',
        pragma: 'no-cache',
        expires: 'Thu, 01 Jan 2025 00:00:00 GMT',
      });
      const next = vi.fn();
      cacheControlVerifier(req, res, next);
      emitFinish(res);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('accepts no-cache as a valid Cache-Control value', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const req = makeReq({ user: { id: 'user-1' } });
      const res = makeRes({
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        expires: '0',
      });
      const next = vi.fn();
      cacheControlVerifier(req, res, next);
      emitFinish(res);
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('accepts private as a valid Cache-Control value', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const req = makeReq({ user: { id: 'user-1' } });
      const res = makeRes({
        'cache-control': 'private, max-age=3600',
        pragma: 'no-cache',
        expires: 'Thu, 01 Jan 2025 00:00:00 GMT',
      });
      const next = vi.fn();
      cacheControlVerifier(req, res, next);
      emitFinish(res);
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
