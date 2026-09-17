import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestIdMiddleware,
  requestLogger,
  addTracingHeaders,
} from '../../src/middleware/requestId.js';

const mockLogger = vi.hoisted(() => {
  const childFn = vi.fn((bindings) => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
    bindings,
  }));
  return {
    child: childFn,
    default: {
      child: childFn,
    },
  };
});

vi.mock('../../src/middleware/logger.js', () => mockLogger);

describe('middleware/requestId', () => {
  const mockRes = (statusCode = 200) => {
    const headers = {};
    const listeners = {};
    return {
      headers,
      locals: {},
      statusCode,
      getHeader: (name) => headers[name],
      setHeader: (name, value) => {
        headers[name] = value;
      },
      on: (event, cb) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      },
      _trigger: (event) => (listeners[event] || []).forEach((cb) => cb()),
    };
  };

  const mockNext = vi.fn();
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNext.mockReset();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('requestIdMiddleware', () => {
    it('generates a valid UUIDv4 when no x-request-id header is provided', () => {
      const req = { headers: {} };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(res.locals.requestId).toBe(req.requestId);
      expect(res.getHeader('X-Request-Id')).toBe(req.requestId);
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('uses incoming x-request-id header when valid', () => {
      const req = { headers: { 'x-request-id': 'valid-request-id-123' } };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.requestId).toBe('valid-request-id-123');
      expect(res.getHeader('X-Request-Id')).toBe('valid-request-id-123');
      expect(res.locals.requestId).toBe('valid-request-id-123');
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('accepts minimum length (1 character) valid request ID', () => {
      const req = { headers: { 'x-request-id': 'a' } };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.requestId).toBe('a');
      expect(res.getHeader('X-Request-Id')).toBe('a');
    });

    it('accepts maximum length (64 characters) valid request ID', () => {
      const maxId = 'A'.repeat(64);
      const req = { headers: { 'x-request-id': maxId } };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.requestId).toBe(maxId);
      expect(res.getHeader('X-Request-Id')).toBe(maxId);
    });

    it('accepts valid characters: uppercase, lowercase, numbers, underscores, dashes', () => {
      const validId = 'Req_123-abc_XYZ';
      const req = { headers: { 'x-request-id': validId } };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.requestId).toBe(validId);
    });

    it('rejects x-request-id exceeding 64 characters (65 chars) and falls back to UUID', () => {
      const longId = 'A'.repeat(65);
      const req = { headers: { 'x-request-id': longId } };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(res.getHeader('X-Request-Id')).toBe(req.requestId);
    });

    it('rejects x-request-id header with invalid characters (spaces)', () => {
      const req = { headers: { 'x-request-id': 'invalid id with spaces!' } };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('rejects x-request-id with log injection or special characters', () => {
      const req = { headers: { 'x-request-id': '<script>alert(1)</script>' } };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('rejects x-request-id with newline characters', () => {
      const req = { headers: { 'x-request-id': 'valid-prefix\r\nInjected: value' } };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('rejects empty string x-request-id and generates UUID', () => {
      const req = { headers: { 'x-request-id': '' } };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('handles non-string x-request-id (array, number, null) safely by generating UUID', () => {
      const nonStringValues = [['req-1', 'req-2'], 12345, null, true, {}];

      for (const val of nonStringValues) {
        const req = { headers: { 'x-request-id': val } };
        const res = mockRes();

        requestIdMiddleware(req, res, mockNext);

        expect(req.requestId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
      }
    });

    it('preserves existing properties in res.locals', () => {
      const req = { headers: {} };
      const res = mockRes();
      res.locals.user = { id: 'usr_1' };
      res.locals.tenant = 'tenant_a';

      requestIdMiddleware(req, res, mockNext);

      expect(res.locals.user).toEqual({ id: 'usr_1' });
      expect(res.locals.tenant).toBe('tenant_a');
      expect(res.locals.requestId).toBe(req.requestId);
    });

    it('preserves unrelated request properties', () => {
      const req = {
        headers: {},
        method: 'POST',
        originalUrl: '/api/v1/shipments',
        body: { weight: 50 },
      };
      const res = mockRes();

      requestIdMiddleware(req, res, mockNext);

      expect(req.method).toBe('POST');
      expect(req.originalUrl).toBe('/api/v1/shipments');
      expect(req.body).toEqual({ weight: 50 });
      expect(req.requestId).toBeDefined();
    });
  });

  describe('requestLogger', () => {
    it('creates child logger bound with requestId and attaches to req.log', () => {
      const req = { headers: {}, requestId: 'req-test-123' };
      const res = mockRes();

      requestLogger(req, res, mockNext);

      expect(mockLogger.default.child).toHaveBeenCalledWith({
        requestId: 'req-test-123',
      });
      expect(req.log).toBeDefined();
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('includes correlationId in child logger bindings when present on req', () => {
      const req = {
        headers: {},
        requestId: 'req-test-123',
        correlationId: 'corr-test-456',
      };
      const res = mockRes();

      requestLogger(req, res, mockNext);

      expect(mockLogger.default.child).toHaveBeenCalledWith({
        requestId: 'req-test-123',
        correlationId: 'corr-test-456',
      });
      expect(req.log).toBeDefined();
    });

    it('does not include correlationId in child logger bindings when req.correlationId is undefined', () => {
      const req = { headers: {}, requestId: 'req-test-123' };
      const res = mockRes();

      requestLogger(req, res, mockNext);

      expect(mockLogger.default.child).toHaveBeenCalledWith({
        requestId: 'req-test-123',
      });
      expect(mockLogger.default.child).not.toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: expect.anything() })
      );
    });

    it('overrides log level when valid x-log-level header is provided in non-production', () => {
      process.env.NODE_ENV = 'development';
      const validLevels = ['info', 'warn', 'error', 'debug', 'trace'];

      for (const level of validLevels) {
        vi.clearAllMocks();
        const req = {
          headers: { 'x-log-level': level.toUpperCase() },
          requestId: 'req-test-123',
        };
        const res = mockRes();

        requestLogger(req, res, mockNext);

        expect(req.log.level).toBe(level);
      }
    });

    it('does not override log level when invalid x-log-level header is provided', () => {
      process.env.NODE_ENV = 'development';
      const req = {
        headers: { 'x-log-level': 'fatal' },
        requestId: 'req-test-123',
      };
      const res = mockRes();

      requestLogger(req, res, mockNext);

      expect(mockLogger.default.child).toHaveBeenCalledWith({
        requestId: 'req-test-123',
      });
      expect(req.log.level).toBe('info');
    });

    it('does not override log level in production even if x-log-level is provided', () => {
      process.env.NODE_ENV = 'production';
      const req = {
        headers: { 'x-log-level': 'debug' },
        requestId: 'req-test-123',
      };
      const res = mockRes();

      requestLogger(req, res, mockNext);

      expect(mockLogger.default.child).toHaveBeenCalledWith({
        requestId: 'req-test-123',
      });
      expect(req.log.level).toBe('info');
    });

    it('handles missing headers object gracefully', () => {
      const req = { requestId: 'req-test-123' };
      const res = mockRes();

      requestLogger(req, res, mockNext);

      expect(req.log).toBeDefined();
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('logs info on response finish when statusCode < 400', () => {
      const req = {
        headers: {},
        requestId: 'req-abc',
        correlationId: 'corr-xyz',
        method: 'GET',
        originalUrl: '/api/v1/trucks',
      };
      const res = mockRes(200);

      requestLogger(req, res, mockNext);
      res._trigger('finish');

      expect(req.log.info).toHaveBeenCalledOnce();
      expect(req.log.warn).not.toHaveBeenCalled();
      expect(req.log.error).not.toHaveBeenCalled();

      const logPayload = req.log.info.mock.calls[0][0];
      expect(logPayload).toEqual({
        requestId: 'req-abc',
        correlationId: 'corr-xyz',
        method: 'GET',
        path: '/api/v1/trucks',
        statusCode: 200,
        durationMs: expect.any(Number),
      });
      expect(logPayload.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('logs warn on response finish when statusCode is between 400 and 499', () => {
      const req = {
        headers: {},
        requestId: 'req-abc',
        method: 'POST',
        originalUrl: '/api/v1/orders',
      };
      const res = mockRes(404);

      requestLogger(req, res, mockNext);
      res._trigger('finish');

      expect(req.log.warn).toHaveBeenCalledOnce();
      expect(req.log.info).not.toHaveBeenCalled();
      expect(req.log.error).not.toHaveBeenCalled();

      const logPayload = req.log.warn.mock.calls[0][0];
      expect(logPayload.statusCode).toBe(404);
      expect(logPayload.method).toBe('POST');
      expect(logPayload.path).toBe('/api/v1/orders');
    });

    it('logs error on response finish when statusCode is 500 or greater', () => {
      const req = {
        headers: {},
        requestId: 'req-abc',
        method: 'DELETE',
        originalUrl: '/api/v1/loads/123',
      };
      const res = mockRes(503);

      requestLogger(req, res, mockNext);
      res._trigger('finish');

      expect(req.log.error).toHaveBeenCalledOnce();
      expect(req.log.warn).not.toHaveBeenCalled();
      expect(req.log.info).not.toHaveBeenCalled();

      const logPayload = req.log.error.mock.calls[0][0];
      expect(logPayload.statusCode).toBe(503);
      expect(logPayload.method).toBe('DELETE');
      expect(logPayload.path).toBe('/api/v1/loads/123');
    });
  });

  describe('addTracingHeaders', () => {
    it('sets X-Trace-Id from requestId', () => {
      const req = { requestId: 'trace-123' };
      const res = mockRes();

      addTracingHeaders(req, res, mockNext);

      expect(res.getHeader('X-Trace-Id')).toBe('trace-123');
      expect(mockNext).toHaveBeenCalledOnce();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('sets X-Span-Id as an 8-character string', () => {
      const req = { requestId: 'trace-123' };
      const res = mockRes();

      addTracingHeaders(req, res, mockNext);

      const spanId = res.getHeader('X-Span-Id');
      expect(typeof spanId).toBe('string');
      expect(spanId).toHaveLength(8);
    });

    it('sets X-User-Id from first 8 chars of req.user.id when user is authenticated', () => {
      const req = { requestId: 'trace-123', user: { id: 'user-abcdefgh-1234' } };
      const res = mockRes();

      addTracingHeaders(req, res, mockNext);

      expect(res.getHeader('X-User-Id')).toBe('user-abc');
    });

    it('sets X-User-Id properly when req.user.id is shorter than 8 chars', () => {
      const req = { requestId: 'trace-123', user: { id: 'usr1' } };
      const res = mockRes();

      addTracingHeaders(req, res, mockNext);

      expect(res.getHeader('X-User-Id')).toBe('usr1');
    });

    it('omits X-User-Id when req.user is missing', () => {
      const req = { requestId: 'trace-123' };
      const res = mockRes();

      addTracingHeaders(req, res, mockNext);

      expect(res.getHeader('X-User-Id')).toBeUndefined();
    });

    it('omits X-User-Id when req.user is null', () => {
      const req = { requestId: 'trace-123', user: null };
      const res = mockRes();

      addTracingHeaders(req, res, mockNext);

      expect(res.getHeader('X-User-Id')).toBeUndefined();
    });

    it('omits X-User-Id when req.user.id is missing or undefined', () => {
      const req = { requestId: 'trace-123', user: {} };
      const res = mockRes();

      addTracingHeaders(req, res, mockNext);

      expect(res.getHeader('X-User-Id')).toBeUndefined();
    });
  });
});
