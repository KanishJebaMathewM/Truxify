/**
 * Unit tests for backend/api/src/middleware/contentType.js
 *
 * Coverage:
 *   - requireJsonContent: passes through for GET/DELETE requests
 *   - requireJsonContent: rejects POST without content-type header (415)
 *   - requireJsonContent: rejects malformed content-type (415)
 *   - requireJsonContent: accepts valid JSON, urlencoded, multipart
 *
 * Run with:  npm test -- test/unit/contentType.test.js
 */
import { describe, it, expect, vi } from 'vitest';
import { requireJsonContent } from '../../src/middleware/contentType.js';

function makeReq(method, contentType) {
  return { method, headers: { 'content-type': contentType } };
}
function makeRes() {
  const r = { status: vi.fn(() => r), json: vi.fn(() => r) };
  return r;
}

describe('requireJsonContent middleware', () => {
  it('passes through GET requests regardless of content-type', () => {
    const req = makeReq('GET');
    const res = makeRes();
    const next = vi.fn();
    requireJsonContent(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes through DELETE requests', () => {
    const req = makeReq('DELETE');
    const res = makeRes();
    const next = vi.fn();
    requireJsonContent(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects POST without content-type header (415)', () => {
    const req = makeReq('POST', undefined);
    const res = makeRes();
    const next = vi.fn();
    requireJsonContent(req, res, next);
    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Unsupported Media Type.',
      received: undefined,
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects malformed content-type with extra tokens (415)', () => {
    const req = makeReq('POST', 'text/plain; application/json');
    const res = makeRes();
    const next = vi.fn();
    requireJsonContent(req, res, next);
    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      received: 'text/plain',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid content-type (415)', () => {
    const req = makeReq('POST', 'text/plain');
    const res = makeRes();
    const next = vi.fn();
    requireJsonContent(req, res, next);
    expect(res.status).toHaveBeenCalledWith(415);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts application/json', () => {
    const req = makeReq('POST', 'application/json');
    const res = makeRes();
    const next = vi.fn();
    requireJsonContent(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts application/json with charset', () => {
    const req = makeReq('POST', 'application/json; charset=utf-8');
    const res = makeRes();
    const next = vi.fn();
    requireJsonContent(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts application/x-www-form-urlencoded', () => {
    const req = makeReq('PUT', 'application/x-www-form-urlencoded');
    const res = makeRes();
    const next = vi.fn();
    requireJsonContent(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts multipart/form-data', () => {
    const req = makeReq('PATCH', 'multipart/form-data; boundary=abc');
    const res = makeRes();
    const next = vi.fn();
    requireJsonContent(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
