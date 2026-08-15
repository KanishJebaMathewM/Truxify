import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import securityHeaders, { setHstsHeader } from '../../src/middleware/securityHeaders.js';

function createApp(preset = {}) {
  const app = express();

  app.use((req, res, next) => {
    for (const [name, value] of Object.entries(preset)) {
      res.setHeader(name, value);
    }
    next();
  });

  app.use(securityHeaders);

  app.get('/test', (req, res) => {
    res.status(200).json({ ok: true });
  });

  return app;
}

const originalEnv = process.env;
const mockReq = (overrides = {}) => ({
  secure: overrides.secure ?? false,
  headers: overrides.headers || {},
});
const mockRes = () => {
  const headers = {};
  return {
    headers,
    getHeader: (name) => headers[name],
    setHeader: (name, value) => {
      headers[name] = value;
    },
  };
};
const mockNext = vi.fn();

describe('securityHeaders', () => {
  it('sets the baseline security headers on a plain request', async () => {
    const res = await request(createApp()).get('/test');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-xss-protection']).toBe('1; mode=block');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toBe(
      'geolocation=(self), camera=(self), microphone=(self)'
    );
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['x-content-security-policy']).toBe("default-src 'self'");
  });

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    mockNext.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('sets X-Content-Type-Options header', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    expect(res.getHeader('X-Content-Type-Options')).toBe('nosniff');
    expect(mockNext).toHaveBeenCalled();
  });

  it('sets X-Frame-Options to DENY', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    expect(res.getHeader('X-Frame-Options')).toBe('DENY');
  });

  it('sets X-XSS-Protection header', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    expect(res.getHeader('X-XSS-Protection')).toBe('1; mode=block');
  });

  it('sets Referrer-Policy header', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    expect(res.getHeader('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy header', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    expect(res.getHeader('Permissions-Policy')).toBe('geolocation=(self), camera=(self), microphone=(self)');
  });

  it('sets Cross-Origin-Resource-Policy header', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    expect(res.getHeader('Cross-Origin-Resource-Policy')).toBe('same-origin');
  });

  it('sets X-Content-Security-Policy header', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq();
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    expect(res.getHeader('X-Content-Security-Policy')).toBe("default-src 'self'");
  });

  it('sets HSTS header when req.secure is true', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq({ secure: true });
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    const hsts = res.getHeader('Strict-Transport-Security');
    expect(hsts).toContain('max-age=');
    expect(hsts).toContain('includeSubDomains');
  });

  it('sets HSTS header when x-forwarded-proto is https', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq({ headers: { 'x-forwarded-proto': 'https' } });
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    const hsts = res.getHeader('Strict-Transport-Security');
    expect(hsts).toContain('max-age=');
    expect(hsts).toContain('includeSubDomains');
  });

  it('does not set HSTS header when not over HTTPS', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq({ secure: false, headers: {} });
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    expect(res.getHeader('Strict-Transport-Security')).toBeUndefined();
  });

  it('does not override existing headers', async () => {
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq();
    const res = mockRes();
    res.setHeader('X-Content-Type-Options', 'already-set');
    securityHeaders(req, res, mockNext);
    expect(res.getHeader('X-Content-Type-Options')).toBe('already-set');
  });

  it('respects SECURE_HSTS_MAX_AGE env var', async () => {
    process.env.SECURE_HSTS_MAX_AGE = '63072000';
    const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');
    const req = mockReq({ secure: true });
    const res = mockRes();
    securityHeaders(req, res, mockNext);
    const hsts = res.getHeader('Strict-Transport-Security');
    expect(hsts).toContain('max-age=63072000');
  });
});

// === Spec 11 test ===
describe('setHstsHeader', () => {
  it('sets when missing', () => {
    const r = { _h: {}, getHeader(k){return this._h[k];}, setHeader(k,v){this._h[k]=v;} };
    expect(setHstsHeader(r)).toBe(true);
  });

  it('sets preload HSTS header', async () => {
    const { setHstsHeader } = await import('../../src/middleware/securityHeaders.js');
    const res = mockRes();
    const result = setHstsHeader(res);
    expect(result).toBe(true);
    expect(res.getHeader('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(res.getHeader('Strict-Transport-Security')).toContain('preload');
  });

  it('returns false when HSTS header already set', async () => {
    const { setHstsHeader } = await import('../../src/middleware/securityHeaders.js');
    const res = mockRes();
    res.setHeader('Strict-Transport-Security', 'already-set');
    const result = setHstsHeader(res);
    expect(result).toBe(false);
  });
});
