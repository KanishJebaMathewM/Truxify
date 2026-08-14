import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireJsonContent } from '../../../src/middleware/contentType.js';

const mockReq = (method = 'GET', headers = {}, body = null) => ({
  method,
  headers,
  body,
});

const mockRes = () => {
  const res = {
    statusCode: null,
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
  };
  return res;
};

describe('requireJsonContent middleware', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
  });

  describe('GET/DELETE requests pass through', () => {
    it('passes through GET requests', () => {
      const req = mockReq('GET');
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeNull();
    });

    it('passes through DELETE requests', () => {
      const req = mockReq('DELETE');
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('POST/PUT/PATCH enforcement', () => {
    it('rejects POST without Content-Type header', () => {
      const req = mockReq('POST', {});
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(res.statusCode).toBe(415);
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts application/json', () => {
      const req = mockReq('POST', { 'content-type': 'application/json' });
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('accepts application/json with charset', () => {
      const req = mockReq('POST', { 'content-type': 'application/json; charset=utf-8' });
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('accepts application/x-www-form-urlencoded', () => {
      const req = mockReq('POST', { 'content-type': 'application/x-www-form-urlencoded' });
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('accepts multipart/form-data', () => {
      const req = mockReq('POST', { 'content-type': 'multipart/form-data; boundary=----' });
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects text/plain', () => {
      const req = mockReq('PUT', { 'content-type': 'text/plain' });
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(res.statusCode).toBe(415);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects application/octet-stream', () => {
      const req = mockReq('PATCH', { 'content-type': 'application/octet-stream' });
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(res.statusCode).toBe(415);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects malformed content-type (text/plain with json)', () => {
      const req = mockReq('POST', { 'content-type': 'text/plain; application/json' });
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(res.statusCode).toBe(415);
    });

    it('rejects invalid JSON mime (application/jsonx)', () => {
      const req = mockReq('POST', { 'content-type': 'application/jsonx' });
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(res.statusCode).toBe(415);
    });

    it('rejects JSON body that is an array', () => {
      const req = mockReq('POST', { 'content-type': 'application/json' }, [1, 2, 3]);
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(res.statusCode).toBe(400);
      expect(res.jsonData.error).toContain('JSON object');
    });

    it('rejects JSON body that is a primitive', () => {
      const req = mockReq('POST', { 'content-type': 'application/json' }, 'string');
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(res.statusCode).toBe(400);
    });

    it('accepts JSON body that is an object', () => {
      const req = mockReq('POST', { 'content-type': 'application/json' }, { key: 'value' });
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('accepts JSON body that is null (empty POST)', () => {
      const req = mockReq('POST', { 'content-type': 'application/json' }, null);
      const res = mockRes();
      requireJsonContent(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });
  });
});
