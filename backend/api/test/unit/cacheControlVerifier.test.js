import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const loggerMocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: loggerMocks.warn,
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import cacheControlVerifier from '../../src/middleware/cacheControlVerifier.js';

class FakeRes extends EventEmitter {
  constructor() {
    super();
    this._headers = {};
  }
  setHeader(key, value) {
    this._headers[key] = value;
  }
  getHeader(key) {
    return this._headers[key];
  }
}

function makeReq() {
  return { method: 'GET', originalUrl: '/api/test' };
}

describe('cacheControlVerifier.js', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
    loggerMocks.warn.mockClear();
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('calls next immediately for requests', () => {
    const res = new FakeRes();
    cacheControlVerifier(makeReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('logs a warning when an authenticated response misses cache headers', () => {
    const req = makeReq();
    req.user = { id: 'u1' };
    const res = new FakeRes();
    cacheControlVerifier(req, res, next);
    res.emit('finish');
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    const payload = loggerMocks.warn.mock.calls[0][0];
    expect(payload.missingHeaders).toEqual(['Cache-Control', 'Pragma', 'Expires']);
  });

  it('does not warn for unauthenticated responses', () => {
    const res = new FakeRes();
    cacheControlVerifier(makeReq(), res, next);
    res.emit('finish');
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('bypasses entirely in production', () => {
    process.env.NODE_ENV = 'production';
    const req = makeReq();
    req.user = { id: 'u1' };
    const res = new FakeRes();
    cacheControlVerifier(req, res, next);
    res.emit('finish');
    expect(next).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });
});