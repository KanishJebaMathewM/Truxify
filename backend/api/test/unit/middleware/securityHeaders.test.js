import { describe, it, expect, vi, beforeEach } from 'vitest';
import securityHeaders, { setHstsHeader } from '../../../src/middleware/securityHeaders.js';

const mockReq = (overrides = {}) => ({
  secure: false,
  headers: {},
  ...overrides,
});

const mockRes = () => {
  const headers = {};
  return {
    headers,
    getHeader(key) {
      return headers[key];
    },
    setHeader(key, value) {
      headers[key] = value;
    },
  };
};

describe('securityHeaders middleware', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
    // Clear env vars between tests
    delete process.env.SECURE_HSTS_MAX_AGE;
    delete process.env.SECURE_HSTS_PRELOAD;
  });

  it('always calls next()', () => {
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets X-Content-Type-Options to nosniff', () => {
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(res.getHeader('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets X-Frame-Options to DENY', () => {
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(res.getHeader('X-Frame-Options')).toBe('DENY');
  });

  it('sets X-XSS-Protection to 1; mode=block', () => {
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(res.getHeader('X-XSS-Protection')).toBe('1; mode=block');
  });

  it('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(res.getHeader('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy correctly', () => {
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(res.getHeader('Permissions-Policy')).toContain('geolocation');
    expect(res.getHeader('Permissions-Policy')).toContain('camera');
    expect(res.getHeader('Permissions-Policy')).toContain('microphone');
  });

  it('sets Cross-Origin-Resource-Policy to same-origin', () => {
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(res.getHeader('Cross-Origin-Resource-Policy')).toBe('same-origin');
  });

  it('sets X-Content-Security-Policy to default-src self', () => {
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(res.getHeader('X-Content-Security-Policy')).toBe("default-src 'self'");
  });

  it('sets HSTS header when request is secure', () => {
    const req = mockReq({ secure: true });
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(res.getHeader('Strict-Transport-Security')).toBeTruthy();
    expect(res.getHeader('Strict-Transport-Security')).toContain('max-age=');
    expect(res.getHeader('Strict-Transport-Security')).toContain('includeSubDomains');
  });

  it('sets HSTS header when x-forwarded-proto is https', () => {
    const req = mockReq({ headers: { 'x-forwarded-proto': 'https' } });
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(res.getHeader('Strict-Transport-Security')).toBeTruthy();
  });

  it('does not set HSTS when not secure', () => {
    const req = mockReq({ secure: false });
    const res = mockRes();
    securityHeaders(req, res, next);
    expect(res.getHeader('Strict-Transport-Security')).toBeFalsy();
  });

  it('does not overwrite existing headers', () => {
    const req = mockReq();
    const res = mockRes();
    res.setHeader('X-Content-Type-Options', 'already-set');
    securityHeaders(req, res, next);
    expect(res.getHeader('X-Content-Type-Options')).toBe('already-set');
  });
});

describe('setHstsHeader', () => {
  beforeEach(() => {
    delete process.env.SECURE_HSTS_PRELOAD;
  });

  it('sets HSTS header with includeSubDomains', () => {
    const res = mockRes();
    const result = setHstsHeader(res);
    expect(result).toBe(true);
    expect(res.getHeader('Strict-Transport-Security')).toContain('includeSubDomains');
  });

  it('returns false if HSTS already set', () => {
    const res = mockRes();
    res.setHeader('Strict-Transport-Security', 'already-set');
    const result = setHstsHeader(res);
    expect(result).toBe(false);
  });

  it('includes preload by default when SECURE_HSTS_PRELOAD is not set', () => {
    // !preload is true when env var is undefined, so includePreload defaults to true
    const res = mockRes();
    setHstsHeader(res);
    expect(res.getHeader('Strict-Transport-Security')).toContain('preload');
  });

  it('omits preload when SECURE_HSTS_PRELOAD is false', () => {
    process.env.SECURE_HSTS_PRELOAD = 'false';
    const res = mockRes();
    setHstsHeader(res);
    expect(res.getHeader('Strict-Transport-Security')).not.toContain('preload');
  });
});
