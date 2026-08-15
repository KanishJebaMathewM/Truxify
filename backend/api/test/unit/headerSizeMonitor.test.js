import { describe, it, expect, vi, beforeEach } from 'vitest';
import headerSizeMonitor from '../../src/middleware/headerSizeMonitor.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let logger;

beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});

function makeReq(headers = {}) {
  return {
    method: 'GET',
    originalUrl: '/api/test',
    headers,
  };
}

function makeRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return {
    getHeader: vi.fn(),
    setHeader: vi.fn(),
    statusCode: 200,
    status,
    json,
    _jsonMock: json,
    on: vi.fn(),
  };
}

describe('headerSizeMonitor', () => {
  it('skips in production (calls next immediately)', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const req = makeReq({ 'content-type': 'application/json' });
      const res = makeRes();
      const next = vi.fn();
      headerSizeMonitor(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('calls next without logging when header size is within limit', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const req = makeReq({ 'content-type': 'application/json' });
      const res = makeRes();
      const next = vi.fn();
      headerSizeMonitor(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('logs a warning when header size exceeds configured limit', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalLimit = process.env.HEADER_SIZE_LIMIT;
    process.env.NODE_ENV = 'development';
    process.env.HEADER_SIZE_LIMIT = '10';
    try {
      const req = makeReq({
        'x-custom-long-header': 'this-is-a-very-long-header-value-that-exceeds-limit',
      });
      const res = makeRes();
      const next = vi.fn();
      headerSizeMonitor(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(431);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/api/test',
          headerSize: expect.any(Number),
          limit: 10,
        }),
        'Request headers exceed configured size threshold'
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalLimit !== undefined) process.env.HEADER_SIZE_LIMIT = originalLimit;
      else delete process.env.HEADER_SIZE_LIMIT;
    }
  });

  it('correctly measures byte size of multi-value headers', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalLimit = process.env.HEADER_SIZE_LIMIT;
    process.env.NODE_ENV = 'development';
    process.env.HEADER_SIZE_LIMIT = '50';
    try {
      const req = makeReq({
        'x-multi': ['value-one', 'value-two'],
      });
      const res = makeRes();
      const next = vi.fn();
      headerSizeMonitor(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      // With 50 byte limit, the multi-value header should not warn
      // as total is less than 50 bytes
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalLimit !== undefined) process.env.HEADER_SIZE_LIMIT = originalLimit;
      else delete process.env.HEADER_SIZE_LIMIT;
    }
  });

  it('uses default limit of 8192 bytes when HEADER_SIZE_LIMIT is not set', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalLimit = process.env.HEADER_SIZE_LIMIT;
    process.env.NODE_ENV = 'development';
    delete process.env.HEADER_SIZE_LIMIT;
    try {
      // Create a header string that exceeds 8192 bytes
      const longValue = 'a'.repeat(9000);
      const req = makeReq({ 'x-long': longValue });
      const res = makeRes();
      const next = vi.fn();
      headerSizeMonitor(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(431);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          headerSize: expect.any(Number),
          limit: 8192,
        }),
        'Request headers exceed configured size threshold'
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalLimit !== undefined) process.env.HEADER_SIZE_LIMIT = originalLimit;
      else delete process.env.HEADER_SIZE_LIMIT;
    }
  });

  it('honours a custom HEADER_SIZE_LIMIT env override', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalLimit = process.env.HEADER_SIZE_LIMIT;
    process.env.NODE_ENV = 'development';
    process.env.HEADER_SIZE_LIMIT = '1000';
    try {
      const req = makeReq({ 'x-mid': 'b'.repeat(500) });
      const res = makeRes();
      const next = vi.fn();
      headerSizeMonitor(req, res, next);
      // 500-byte value + header name stays under the 1000-byte limit.
      expect(next).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalLimit !== undefined) process.env.HEADER_SIZE_LIMIT = originalLimit;
      else delete process.env.HEADER_SIZE_LIMIT;
    }
  });

  it('does not throw when a header value is a top-level undefined', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalLimit = process.env.HEADER_SIZE_LIMIT;
    process.env.NODE_ENV = 'development';
    process.env.HEADER_SIZE_LIMIT = '5000';
    try {
      const req = makeReq({ 'x-undefined': undefined, 'x-ok': 'value' });
      const res = makeRes();
      const next = vi.fn();
      expect(() => headerSizeMonitor(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalledOnce();
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalLimit !== undefined) process.env.HEADER_SIZE_LIMIT = originalLimit;
      else delete process.env.HEADER_SIZE_LIMIT;
    }
  });
});
