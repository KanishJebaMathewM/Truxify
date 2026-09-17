import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  child: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: 'info',
  }),
  default: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      level: 'info',
    }),
  },
}));

vi.mock('../../src/middleware/logger.js', () => mockLogger);

describe('middleware/requestId', () => {
  const mockRes = () => {
    const headers = {};
    const listeners = {};
    return {
      headers,
      locals: {},
      getHeader: (name) => headers[name],
      setHeader: (name, value) => {
        headers[name] = value;
      },
      statusCode: 200,
      on: (event, cb) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      },
      _trigger: (event) => (listeners[event] || []).forEach((cb) => cb()),
    };
  };
  const mockNext = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockNext.mockReset();
  });

  describe('requestIdMiddleware', () => {
    it('generates a UUID when no x-request-id header is provided', async () => {
      const { requestIdMiddleware } = await import('../../src/middleware/requestId.js');
      const req = { headers: {} };
      const res = mockRes();
      requestIdMiddleware(req, res, mockNext);
      expect(req.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(mockNext).toHaveBeenCalled();
    });

    it('uses x-request-id header when valid', async () => {
      const { requestIdMiddleware } = await import('../../src/middleware/requestId.js');
      const req = { headers: { 'x-request-id': 'valid-request-id-123' } };
      const res = mockRes();
      requestIdMiddleware(req, res, mockNext);
      expect(req.requestId).toBe('valid-request-id-123');
      expect(res.getHeader('X-Request-Id')).toBe('valid-request-id-123');
    });

    it('rejects x-request-id header with invalid characters', async () => {
      const { requestIdMiddleware } = await import('../../src/middleware/requestId.js');
      const req = { headers: { 'x-request-id': 'invalid id with spaces!' } };
      const res = mockRes();
      requestIdMiddleware(req, res, mockNext);
      expect(req.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('sets X-Request-Id response header', async () => {
      const { requestIdMiddleware } = await import('../../src/middleware/requestId.js');
      const req = { headers: {} };
      const res = mockRes();
      requestIdMiddleware(req, res, mockNext);
      expect(res.getHeader('X-Request-Id')).toBe(req.requestId);
    });

    it('stores requestId in res.locals', async () => {
      const { requestIdMiddleware } = await import('../../src/middleware/requestId.js');
      const req = { headers: {} };
      const res = mockRes();
      requestIdMiddleware(req, res, mockNext);
      expect(res.locals.requestId).toBe(req.requestId);
    });
  });

  describe('addTracingHeaders', () => {
    it('sets X-Trace-Id from requestId', async () => {
      const { addTracingHeaders } = await import('../../src/middleware/requestId.js');
      const req = { requestId: 'trace-123' };
      const res = mockRes();
      addTracingHeaders(req, res, mockNext);
      expect(res.getHeader('X-Trace-Id')).toBe('trace-123');
      expect(mockNext).toHaveBeenCalled();
    });

    it('sets X-Span-Id as 8-char hex', async () => {
      const { addTracingHeaders } = await import('../../src/middleware/requestId.js');
      const req = { requestId: 'trace-123' };
      const res = mockRes();
      addTracingHeaders(req, res, mockNext);
      const spanId = res.getHeader('X-Span-Id');
      expect(spanId).toMatch(/^[0-9a-f]{8}$/);
    });

    it('sets X-User-Id from req.user.id', async () => {
      const { addTracingHeaders } = await import('../../src/middleware/requestId.js');
      const req = { requestId: 'trace-123', user: { id: 'user-abcdefgh' } };
      const res = mockRes();
      addTracingHeaders(req, res, mockNext);
      expect(res.getHeader('X-User-Id')).toBe('user-abc');
    });

    it('omits X-User-Id when req.user is missing', async () => {
      const { addTracingHeaders } = await import('../../src/middleware/requestId.js');
      const req = { requestId: 'trace-123' };
      const res = mockRes();
      addTracingHeaders(req, res, mockNext);
      expect(res.getHeader('X-User-Id')).toBeUndefined();
    });
  });
});
