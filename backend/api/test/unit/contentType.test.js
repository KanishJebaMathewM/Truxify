/**
 * Unit tests for backend/api/src/middleware/contentType.js
 *
 * Coverage:
 *   - Returns 415 for POST/PUT/PATCH without content-type header
 *   - Returns 415 for POST/PUT/PATCH with unsupported content-type
 *   - Calls next() for POST/PUT/PATCH with application/json
 *   - Calls next() for POST/PUT/PATCH with application/x-www-form-urlencoded
 *   - Calls next() for POST/PUT/PATCH with multipart/form-data
 *   - Ignores GET/DELETE requests (calls next() without checking)
 *   - Ignores charset parameter in content-type comparison
 *
 * Run with: npx vitest run test/unit/contentType.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireJsonContent } from '../../src/middleware/contentType.js';

function createMocks(overrides = {}) {
  const jsonMock = vi.fn();
  const statusMock = vi.fn(() => ({
    json: jsonMock,
  }));
  return {
    req: {
      method: 'POST',
      headers: {},
      ...overrides.req,
    },
    res: {
      status: statusMock,
      _jsonMock: jsonMock,
      ...overrides.res,
    },
    next: vi.fn(),
  };
}

describe('requireJsonContent', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = { method: 'POST', headers: {} };
    res = {
      status: vi.fn(() => ({
        json: vi.fn(),
      })),
    };
    next = vi.fn();
  });

  describe('POST requests', () => {
    it('returns 415 when content-type header is missing', () => {
      const { req, res, next } = createMocks();
      requireJsonContent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(res._jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Unsupported Media Type.' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 415 when content-type is text/plain', () => {
      const { req, res, next } = createMocks({
        req: {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
        },
      });
      requireJsonContent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 415 for malformed content-type with charset prefix', () => {
      const { req, res, next } = createMocks({
        req: {
          method: 'POST',
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        },
      });
      requireJsonContent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() for application/json', () => {
      const { req, res, next } = createMocks({
        req: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
      });
      requireJsonContent(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next() for application/json with charset', () => {
      const { req, res, next } = createMocks({
        req: {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      });
      requireJsonContent(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next() for application/x-www-form-urlencoded', () => {
      const { req, res, next } = createMocks({
        req: {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        },
      });
      requireJsonContent(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next() for multipart/form-data', () => {
      const { req, res, next } = createMocks({
        req: {
          method: 'POST',
          headers: { 'content-type': 'multipart/form-data; boundary=----FormBoundary' },
        },
      });
      requireJsonContent(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('PUT requests', () => {
    it('returns 415 when PUT has no content-type', () => {
      const { req, res, next } = createMocks({ req: { method: 'PUT', headers: {} } });
      requireJsonContent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() for PUT with application/json', () => {
      const { req, res, next } = createMocks({
        req: { method: 'PUT', headers: { 'content-type': 'application/json' } },
      });
      requireJsonContent(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('PATCH requests', () => {
    it('returns 415 when PATCH has no content-type', () => {
      const { req, res, next } = createMocks({ req: { method: 'PATCH', headers: {} } });
      requireJsonContent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() for PATCH with application/json', () => {
      const { req, res, next } = createMocks({
        req: { method: 'PATCH', headers: { 'content-type': 'application/json' } },
      });
      requireJsonContent(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('GET requests (pass-through)', () => {
    it('calls next() without checking content-type for GET', () => {
      const { req, res, next } = createMocks({ req: { method: 'GET', headers: {} } });
      requireJsonContent(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('DELETE requests (pass-through)', () => {
    it('calls next() without checking content-type for DELETE', () => {
      const { req, res, next } = createMocks({ req: { method: 'DELETE', headers: {} } });
      requireJsonContent(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
