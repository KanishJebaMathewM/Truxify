/**
 * Unit tests for backend/api/src/middleware/securityHeaderDuplicates.js
 *
 * Coverage:
 *   - Skips all monitoring in production
 *   - No warning on the first assignment of a monitored security header
 *   - Warning when the same monitored header is assigned more than once
 *   - No false-positive duplicate warning for repeated Set-Cookie arrays
 *   - Warning when the exact same cookie value is repeated
 *   - Non-string header names (e.g. undefined) are passed through to the
 *     original setHeader without raising a TypeError
 *   - Monitored string headers are still normalized and duplicate-checked
 *   - next() is always invoked
 *
 * Run with: npx vitest run test/unit/securityHeaderDuplicates.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import securityHeaderDuplicates from '../../src/middleware/securityHeaderDuplicates.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let logger;

beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});

function makeReq() {
  return {
    method: 'GET',
    originalUrl: '/api/test',
  };
}

function makeRes() {
  const originalSetHeader = vi.fn();
  const res = {
    originalSetHeader,
    setHeader: originalSetHeader,
    on: vi.fn(),
  };
  return res;
}

describe('securityHeaderDuplicates', () => {
  it('skips monitoring in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const req = makeReq();
      const originalSetHeader = vi.fn();
      const res = { setHeader: originalSetHeader, on: vi.fn() };
      const next = vi.fn();
      securityHeaderDuplicates(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.setHeader).toBe(originalSetHeader);
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Frame-Options', 'DENY');
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('does not warn on the first assignment of a monitored header', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('X-Frame-Options', 'DENY');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('warns when the same monitored header is assigned more than once', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/test',
        header: 'x-frame-options',
      }),
      'Duplicate security header assignment detected'
    );
  });

  it('does not flag distinct cookies set via repeated Set-Cookie arrays', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('Set-Cookie', ['session=abc; Path=/', 'theme=dark; Path=/']);
    res.setHeader('Set-Cookie', ['csrf=xyz; Path=/']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not flag distinct scalar Set-Cookie assignments', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('Set-Cookie', 'session=abc; Path=/');
    res.setHeader('Set-Cookie', 'theme=dark; Path=/');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns when the exact same Set-Cookie value is repeated', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('Set-Cookie', 'session=abc; Path=/');
    res.setHeader('Set-Cookie', 'session=abc; Path=/');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        header: 'set-cookie',
      }),
      'Duplicate security header assignment detected'
    );
  });

  it('warns when the same cookie appears twice inside a Set-Cookie array', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('Set-Cookie', ['session=abc; Path=/', 'session=abc; Path=/']);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('securityHeaderDuplicates setHeader guard', () => {
  it('passes through undefined header names without throwing', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    securityHeaderDuplicates(req, res, next);
    expect(() => res.setHeader(undefined, 'value')).not.toThrow();
    expect(res.originalSetHeader).toHaveBeenCalledWith(undefined, 'value');
    expect(next).toHaveBeenCalledOnce();
  });

  it('passes through null and non-string header names without throwing', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    securityHeaderDuplicates(req, res, next);
    expect(() => res.setHeader(null, 'value')).not.toThrow();
    expect(() => res.setHeader(123, 'value')).not.toThrow();
    expect(res.originalSetHeader).toHaveBeenNthCalledWith(1, null, 'value');
    expect(res.originalSetHeader).toHaveBeenNthCalledWith(2, 123, 'value');
  });

  it('still normalizes and duplicate-checks string header names', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    securityHeaderDuplicates(req, res, next);
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(res.originalSetHeader).toHaveBeenCalledTimes(2);
  });

  it('does not warn for non-string names even when repeated', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    securityHeaderDuplicates(req, res, next);
    res.setHeader(undefined, 'a');
    res.setHeader(undefined, 'b');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
