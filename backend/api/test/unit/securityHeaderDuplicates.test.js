import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { default: securityHeaderDuplicates } = await import('../../src/middleware/securityHeaderDuplicates.js');

function makeMocks() {
  const req = { method: 'GET', originalUrl: '/test' };
  const res = {
    _headers: {},
    setHeader(name, value) {
      this._headers[String(name).toLowerCase()] = value;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('securityHeaderDuplicates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  it('does not warn on the first assignment of a monitored header', () => {
    const { req, res, next } = makeMocks();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('warns when a monitored header is re-assigned with a different value', () => {
    const { req, res, next } = makeMocks();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      path: '/test',
      header: 'x-frame-options',
    });
  });

  it('does not warn when the same value is set twice (idempotent re-set)', () => {
    const { req, res, next } = makeMocks();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('treats an array-valued assignment as a single logical set', () => {
    const { req, res, next } = makeMocks();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('skips monitoring entirely in production', () => {
    process.env.NODE_ENV = 'production';
    const { req, res, next } = makeMocks();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('calls next() to continue the chain', () => {
    const { req, res, next } = makeMocks();
    securityHeaderDuplicates(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
