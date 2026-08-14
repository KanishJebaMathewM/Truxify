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

const { default: securityHeadersVerifier } = await import('../../src/middleware/securityHeadersVerifier.js');

function makeMocks({ env = 'development', headers = {} } = {}) {
  let finishHandler = null;
  const req = { method: 'GET', originalUrl: '/api/test' };
  const res = {
    getHeader: vi.fn((name) => headers[String(name).toLowerCase()]),
    on: vi.fn((event, handler) => {
      if (event === 'finish') finishHandler = handler;
    }),
    _finish() {
      if (finishHandler) finishHandler();
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('securityHeadersVerifier', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('warns when expected security headers are missing', () => {
    const { req, res, next } = makeMocks();
    securityHeadersVerifier(req, res, next);
    res._finish();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/test',
        missingHeaders: expect.arrayContaining([
          'x-content-type-options',
          'referrer-policy',
          'permissions-policy',
          'cross-origin-resource-policy',
        ]),
      }),
      'Missing expected security headers'
    );
  });

  it('does not warn when all required headers are present', () => {
    const { req, res, next } = makeMocks({
      headers: {
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'geolocation=(self)',
        'cross-origin-resource-policy': 'same-origin',
      },
    });
    securityHeadersVerifier(req, res, next);
    res._finish();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('reports only the headers that are missing', () => {
    const { req, res, next } = makeMocks({
      headers: { 'x-content-type-options': 'nosniff' },
    });
    securityHeadersVerifier(req, res, next);
    res._finish();
    const payload = mockLogger.warn.mock.calls[0][0];
    expect(payload.missingHeaders).not.toContain('x-content-type-options');
    expect(payload.missingHeaders).toContain('referrer-policy');
    expect(payload.missingHeaders).toContain('permissions-policy');
  });

  it('skips verification entirely in production', () => {
    process.env.NODE_ENV = 'production';
    const { req, res, next } = makeMocks();
    securityHeadersVerifier(req, res, next);
    res._finish();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('calls next() to continue the chain', () => {
    const { req, res, next } = makeMocks();
    securityHeadersVerifier(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

