import { describe, it, expect, beforeEach } from 'vitest';
import { verifyCacheControl } from '../../../src/middleware/cacheControlVerifier.js';

function makeRes() {
  const json = vi.fn();
  return { status: vi.fn(() => ({ json })), json };
}

function makeReq(headers = {}) {
  return { method: 'GET', headers };
}

describe('cacheControlVerifier.js', () => {
  let req, res, next;

  beforeEach(() => {
    req = makeReq();
    res = makeRes();
    next = vi.fn();
  });

  it('calls next for GET requests without no-cache', () => {
    verifyCacheControl(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 304 for GET with no-cache and valid ETag', () => {
    req.headers['cache-control'] = 'no-cache';
    req.headers['if-none-match'] = '"abc123"';
    verifyCacheControl(req, res, next);
    expect(res.status).toHaveBeenCalledWith(304);
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores POST requests', () => {
    req.method = 'POST';
    verifyCacheControl(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
