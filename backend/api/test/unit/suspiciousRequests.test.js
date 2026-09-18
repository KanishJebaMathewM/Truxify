import { describe, it, expect, vi } from 'vitest';
import suspiciousRequests, { sanitizeKey, sanitizeQueryParams } from '../../src/middleware/suspiciousRequests.js';

describe('suspiciousRequests Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeReqRes(overrides = {}) {
    const req = {
      headers: {},
      query: {},
      body: {},
      originalUrl: '/api/test',
      ...overrides,
    };

    const res = {
      status: vi.fn(() => res),
      json: vi.fn(() => res),
    };

    const next = vi.fn();

    return { req, res, next };
  }

  it('calls next() for normal requests', () => {
    const { req, res, next } = makeReqRes();

    suspiciousRequests(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.suspicious).toBeUndefined();
  });

  it('blocks SQL injection requests with 403', () => {
    const { req, res, next } = makeReqRes({
      body: { username: "' OR 1=1 --" },
    });

    suspiciousRequests(req, res, next);

    expect(req.suspicious).toBe(true);
    expect(req.threatFindings).toContain('SQL Injection');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Request blocked: suspicious content detected',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('blocks path traversal requests with 403', () => {
    const { req, res, next } = makeReqRes({
      originalUrl: '/api/files/../../etc/passwd',
    });

    suspiciousRequests(req, res, next);

    expect(req.suspicious).toBe(true);
    expect(req.threatFindings).toContain('Path Traversal');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('marks XSS requests as suspicious but calls next()', () => {
    const { req, res, next } = makeReqRes({
      body: { comment: '<script>alert(1)</script>' },
    });

    suspiciousRequests(req, res, next);

    expect(req.suspicious).toBe(true);
    expect(req.threatFindings).toContain('Cross-Site Scripting');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('marks suspicious user agents but calls next()', () => {
    const { req, res, next } = makeReqRes({
      headers: { 'user-agent': 'sqlmap/1.8' },
    });

    suspiciousRequests(req, res, next);

    expect(req.suspicious).toBe(true);
    expect(req.threatFindings).toContain('Suspicious User Agent');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('records multiple findings and blocks when a blocking threat is present', () => {
    const { req, res, next } = makeReqRes({
      body: { comment: '<script>alert(1)</script>', query: "' OR 1=1" },
      headers: { 'user-agent': 'sqlmap' },
    });

    suspiciousRequests(req, res, next);

    expect(req.suspicious).toBe(true);
    expect(req.threatFindings).toEqual([
      'SQL Injection',
      'Cross-Site Scripting',
      'Suspicious User Agent',
    ]);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});


// === Spec 6 test ===
describe('sanitizeKey', () => {
  it('rejects __proto__', () => { expect(sanitizeKey('__proto__')).toBeNull(); });
  it('rejects constructor', () => { expect(sanitizeKey('constructor')).toBeNull(); });
  it('accepts normal', () => { expect(sanitizeKey('name')).toBe('name'); });
});
describe('sanitizeQueryParams', () => {
  it('strips dangerous', () => {
    expect(sanitizeQueryParams({ name: 'x', __proto__: 'y' })).toEqual({ name: 'x' });
  });
  it('null → {}', () => { expect(sanitizeQueryParams(null)).toEqual({}); });
});

