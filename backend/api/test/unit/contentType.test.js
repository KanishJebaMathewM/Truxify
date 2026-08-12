import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireJsonContent } from '../../src/middleware/contentType.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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

describe('contentType', () => {
  it('is a function', async () => {
    const mod = await import('../../src/middleware/contentType.js');
    expect(typeof (mod.requireJsonContent || mod.default)).toBe('function');
  });

  describe('array-valued content-type header', () => {
    it('accepts the first value when the header is a repeated array', () => {
      const { req, res, next } = createMocks({
        req: { method: 'POST', headers: { 'content-type': ['application/json', 'text/plain'] } },
      });
      requireJsonContent(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 415 when the array holds an unsupported media type', () => {
      const { req, res, next } = createMocks({
        req: { method: 'POST', headers: { 'content-type': ['text/plain'] } },
      });
      requireJsonContent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(res._jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Unsupported Media Type.', received: 'text/plain' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 415 without throwing when the array is empty', () => {
      const { req, res, next } = createMocks({
        req: { method: 'POST', headers: { 'content-type': [] } },
      });
      expect(() => requireJsonContent(req, res, next)).not.toThrow();
      expect(res.status).toHaveBeenCalledWith(415);
      expect(next).not.toHaveBeenCalled();
    });
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

    it('accepts an uppercase media type (case-insensitive)', () => {
      const { req, res, next } = createMocks({
        req: {
          method: 'POST',
          headers: { 'content-type': 'APPLICATION/JSON' },
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
