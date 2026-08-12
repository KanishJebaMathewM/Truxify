import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

function makeMocks() {
  let finishHandler = null;
  const res = {
    getHeader: vi.fn(() => undefined),
    on: vi.fn((event, handler) => {
      if (event === 'finish') finishHandler = handler;
    }),
    _finish() {
      if (finishHandler) finishHandler();
    },
  };
  return { req: { method: 'GET', originalUrl: '/x' }, res, next: vi.fn() };
}

describe('securityHeadersVerifier environment behaviour', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('warns in development when required headers are missing', () => {
    const { req, res, next } = makeMocks();
    securityHeadersVerifier(req, res, next);
    res._finish();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  it('skips verification in production', () => {
    process.env.NODE_ENV = 'production';
    const { req, res, next } = makeMocks();
    securityHeadersVerifier(req, res, next);
    res._finish();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('still verifies in test environments (only production skips)', () => {
    process.env.NODE_ENV = 'test';
    const { req, res, next } = makeMocks();
    securityHeadersVerifier(req, res, next);
    res._finish();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalled();
  });

  it('calls next immediately regardless of environment', () => {
    const { req, res, next } = makeMocks();
    securityHeadersVerifier(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
