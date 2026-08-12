import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestIdMiddleware, requestLogger, addTracingHeaders } from '../../src/middleware/requestId.js';

vi.mock('../../src/middleware/logger.js', () => {
  const mLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  mLogger.child = vi.fn(() => mLogger);
  return { default: mLogger };
});

function makeReq(overrides = {}) {
  return { requestId: undefined, originalUrl: '/api/test', method: 'GET', headers: {}, ...overrides };
}

function makeRes(statusCode = 200) {
  const listeners = {};
  return {
    statusCode,
    locals: {},
    setHeader: vi.fn(),
    on: (event, cb) => { listeners[event] = cb; },
    emit: (event) => listeners[event]?.(),
  };
}

describe('requestIdMiddleware', () => {
  it('attaches a UUID to req.requestId', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    requestIdMiddleware(req, res, next);
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets X-Request-Id response header', () => {
    const req = makeReq();
    const res = makeRes();
    requestIdMiddleware(req, res, vi.fn());
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
  });

  it('propagates an inbound X-Request-Id header instead of generating a new one', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const req = makeReq({ headers: { 'x-request-id': validUuid } });
    const res = makeRes();
    requestIdMiddleware(req, res, vi.fn());
    expect(req.requestId).toBe(validUuid);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', validUuid);
  });

  it('generates a unique ID per request', () => {
    const req1 = makeReq();
    const req2 = makeReq();
    requestIdMiddleware(req1, makeRes(), vi.fn());
    requestIdMiddleware(req2, makeRes(), vi.fn());
    expect(req1.requestId).not.toBe(req2.requestId);
  });

  it('ignores an inbound id with unsafe characters', () => {
    const req = makeReq({ headers: { 'x-request-id': 'bad id with spaces!' } });
    const res = makeRes();
    requestIdMiddleware(req, res, vi.fn());
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('ignores an inbound id that exceeds the length limit', () => {
    const req = makeReq({ headers: { 'x-request-id': 'a'.repeat(65) } });
    const res = makeRes();
    requestIdMiddleware(req, res, vi.fn());
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});

describe('requestLogger', () => {
  let logger;
  beforeEach(async () => {
    logger = (await import('../../src/middleware/logger.js')).default;
    vi.clearAllMocks();
  });

  it('logs info for 2xx responses', () => {
    const req = { requestId: 'test-id', method: 'GET', originalUrl: '/api/health' };
    const res = makeRes(200);
    requestLogger(req, res, vi.fn());
    res.emit('finish');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'test-id', statusCode: 200 })
    );
  });

  it('logs warn for 4xx responses', () => {
    const req = { requestId: 'test-id', method: 'GET', originalUrl: '/api/missing' };
    const res = makeRes(404);
    requestLogger(req, res, vi.fn());
    res.emit('finish');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'test-id', statusCode: 404 })
    );
  });

  it('logs error for 5xx responses', () => {
    const req = { requestId: 'test-id', method: 'POST', originalUrl: '/api/orders' };
    const res = makeRes(500);
    requestLogger(req, res, vi.fn());
    res.emit('finish');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'test-id', statusCode: 500 })
    );
  });

  it('includes durationMs in log payload', () => {
    const req = { requestId: 'test-id', method: 'GET', originalUrl: '/api/health' };
    const res = makeRes(200);
    requestLogger(req, res, vi.fn());
    res.emit('finish');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: expect.any(Number) })
    );
  });

  it('never logs a negative durationMs', () => {
    const req = { requestId: 'test-id', method: 'GET', originalUrl: '/api/health' };
    const res = makeRes(200);
    requestLogger(req, res, vi.fn());
    // Force a "finish" that fires instantly; the clamped duration must be >= 0.
    res.emit('finish');
    const payload = logger.info.mock.calls[0][0];
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('addTracingHeaders', () => {
  it('sets X-Trace-Id and X-Span-Id headers', () => {
    const req = { requestId: 'req-1' };
    const res = makeRes();
    addTracingHeaders(req, res, vi.fn());
    expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', 'req-1');
    expect(res.setHeader).toHaveBeenCalledWith('X-Span-Id', expect.any(String));
  });

  it('sets a truncated X-User-Id when req.user is present', () => {
    const req = { requestId: 'req-1', user: { id: 'user-abcdef1234567890' } };
    const res = makeRes();
    addTracingHeaders(req, res, vi.fn());
    expect(res.setHeader).toHaveBeenCalledWith('X-User-Id', 'user-abc');
  });

  it('does not set X-User-Id for anonymous requests', () => {
    const req = { requestId: 'req-1' };
    const res = makeRes();
    addTracingHeaders(req, res, vi.fn());
    const calls = res.setHeader.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('X-User-Id');
  });

  it('calls next to continue the chain', () => {
    const next = vi.fn();
    addTracingHeaders({ requestId: 'req-1' }, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
