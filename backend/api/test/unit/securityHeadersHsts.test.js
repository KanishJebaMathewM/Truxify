import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { default: securityHeaders } = await import('../../src/middleware/securityHeaders.js');

function makeMocks(overrides = {}) {
  const headers = {};
  const req = {
    secure: true,
    headers: {},
    ...overrides,
  };
  const res = {
    _headers: headers,
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('securityHeaders HSTS max-age', () => {
  beforeEach(() => {
    delete process.env.SECURE_HSTS_MAX_AGE;
  });

  afterEach(() => {
    delete process.env.SECURE_HSTS_MAX_AGE;
  });

  it('sets the default HSTS max-age when no env override is present', () => {
    const { req, res, next } = makeMocks();
    securityHeaders(req, res, next);
    expect(res._headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('uses SECURE_HSTS_MAX_AGE when set to a valid value', () => {
    process.env.SECURE_HSTS_MAX_AGE = '172800';
    const { req, res, next } = makeMocks();
    securityHeaders(req, res, next);
    expect(res._headers['strict-transport-security']).toBe('max-age=172800; includeSubDomains');
  });

  it('falls back to the default when the override is below the minimum floor', () => {
    process.env.SECURE_HSTS_MAX_AGE = '60';
    const { req, res, next } = makeMocks();
    securityHeaders(req, res, next);
    expect(res._headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('falls back to the default when the override is not a finite number', () => {
    process.env.SECURE_HSTS_MAX_AGE = 'abc';
    const { req, res, next } = makeMocks();
    securityHeaders(req, res, next);
    expect(res._headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('does not emit HSTS for plain HTTP requests', () => {
    const { req, res, next } = makeMocks({ secure: false });
    securityHeaders(req, res, next);
    expect(res._headers['strict-transport-security']).toBeUndefined();
  });
});
