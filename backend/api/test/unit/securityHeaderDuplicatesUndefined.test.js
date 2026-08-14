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
      if (name === undefined) return;
      this._headers[String(name).toLowerCase()] = value;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('securityHeaderDuplicates undefined-header guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  it('does not throw when setHeader is called with an undefined name', () => {
    const { req, res, next } = makeMocks();
    securityHeaderDuplicates(req, res, next);
    expect(() => res.setHeader(undefined, 'value')).not.toThrow();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('does not throw when setHeader is called with a null name', () => {
    const { req, res, next } = makeMocks();
    securityHeaderDuplicates(req, res, next);
    expect(() => res.setHeader(null, 'value')).not.toThrow();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('still monitors valid headers after an undefined-name call', () => {
    const { req, res, next } = makeMocks();
    securityHeaderDuplicates(req, res, next);
    res.setHeader(undefined, 'ignored');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});
