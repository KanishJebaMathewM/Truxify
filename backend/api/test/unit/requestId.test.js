import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestIdMiddleware, requestLogger } from '../../src/middleware/requestId.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeReq(overrides = {}) {
  return { requestId: undefined, originalUrl: '/api/test', method: 'GET', headers: {}, ...overrides };
}

function makeRes(statusCode = 200) {
  const listeners = {};
  return {
    statusCode,
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
    const req = makeReq({ headers: { 'x-request-id': 'upstream-trace-id-abc' } });
    const res = makeRes();
    requestIdMiddleware(req, res, vi.fn());
    expect(req.requestId).toBe('upstream-trace-id-abc');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'upstream-trace-id-abc');
  });

  it('generates a unique ID per request', () => {
    const req1 = makeReq();
    const req2 = makeReq();
    requestIdMiddleware(req1, makeRes(), vi.fn());
    requestIdMiddleware(req2, makeRes(), vi.fn());
    expect(req1.requestId).not.toBe(req2.requestId);
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
});
