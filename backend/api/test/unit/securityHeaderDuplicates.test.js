/**
 * Unit tests for backend/api/src/middleware/securityHeaderDuplicates.js
 *
 * Coverage:
 *   - Skips all monitoring in production
 *   - No warning on the first assignment of a monitored security header
 *   - Warning when the same monitored header is assigned more than once
 *   - No false-positive duplicate warning for repeated Set-Cookie arrays
 *   - Warning when the exact same cookie value is repeated
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
  return {
    setHeader: vi.fn(),
    on: vi.fn(),
  };
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
