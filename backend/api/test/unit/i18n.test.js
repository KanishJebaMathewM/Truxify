import { describe, it, expect, vi, beforeEach } from 'vitest';
import defaultI18nMiddleware, { errorTranslationInterceptor } from '../../src/middleware/i18n.js';
// backend/api/test/unit/i18n.test.js

import { describe, it, expect, vi } from 'vitest';
import { errorTranslationInterceptor } from '../../src/middleware/i18n.js';

describe('errorTranslationInterceptor middleware', () => {
  it('should translate error strings when an error payload is returned', () => {
    const req = { headers: { 'accept-language': 'es' } };
    const res = {
      json: vi.fn(),
    };
    const next = vi.fn();

    // Attach middleware
    errorTranslationInterceptor(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    // Simulate route handler calling res.json with an error body
    res.json({ success: false, error: 'User not found' });

    // Verify that res.json was invoked (with translated or intercepted body)
    expect(res.json).toHaveBeenCalledTimes(1);
    const interceptedBody = res.json.mock.calls[0][0];
    expect(interceptedBody).toHaveProperty('success', false);
    expect(interceptedBody).toHaveProperty('error');
  });

  it('should pass non-error bodies unchanged', () => {
    const req = { headers: {} };
    const res = {
      json: vi.fn(),
    };
    const next = vi.fn();

    errorTranslationInterceptor(req, res, next);

    const normalBody = { success: true, data: { id: 1, name: 'Load #102' } };
    res.json(normalBody);

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0]).toEqual(normalBody);
  });
});
describe('i18n Middleware and errorTranslationInterceptor', () => {
  let mockReq;
  let mockRes;
  let mockNext;
  let capturedOriginalJson;

  beforeEach(() => {
    capturedOriginalJson = vi.fn();
    mockReq = {
      t: vi.fn((key) => key),
    };
    mockNext = vi.fn();
    mockRes = {
      json: capturedOriginalJson,
    };
  });

  describe('Module Exports', () => {
    it('exports errorTranslationInterceptor as named and default export', () => {
      expect(typeof errorTranslationInterceptor).toBe('function');
      expect(defaultI18nMiddleware).toBe(errorTranslationInterceptor);
    });
  });

  describe('errorTranslationInterceptor', () => {
    it('calls next immediately upon middleware execution', () => {
      errorTranslationInterceptor(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('translates error string in res.json body', () => {
      const translated = 'Error traducido';
      mockReq.t = vi.fn().mockReturnValue(translated);
      capturedOriginalJson.mockReturnValue(mockRes);

      errorTranslationInterceptor(mockReq, mockRes, mockNext);

      const wrappedJson = mockRes.json;
      const body = { error: 'UNAUTHORIZED' };
      wrappedJson(body);

      expect(mockReq.t).toHaveBeenCalledWith('UNAUTHORIZED', { defaultValue: 'UNAUTHORIZED' });
      expect(body.error).toBe(translated);
      expect(capturedOriginalJson).toHaveBeenCalledWith(body);
    });

    it('preserves other fields in res.json body alongside translated error', () => {
      mockReq.t = vi.fn().mockReturnValue('Forbidden action');
      capturedOriginalJson.mockReturnValue(mockRes);

      errorTranslationInterceptor(mockReq, mockRes, mockNext);

      const wrappedJson = mockRes.json;
      const body = { error: 'FORBIDDEN', code: 403, timestamp: 123456789 };
      wrappedJson(body);

      expect(body.error).toBe('Forbidden action');
      expect(body.code).toBe(403);
      expect(body.timestamp).toBe(123456789);
    });

    it('passes non-object bodies through unchanged', () => {
      mockReq.t = vi.fn();
      capturedOriginalJson.mockReturnValue(mockRes);

      errorTranslationInterceptor(mockReq, mockRes, mockNext);

      const wrappedJson = mockRes.json;
      const arr = ['a', 'b', 'c'];
      wrappedJson(arr);

      expect(arr).toEqual(['a', 'b', 'c']);
      expect(mockReq.t).not.toHaveBeenCalled();
      expect(capturedOriginalJson).toHaveBeenCalledWith(arr);

      wrappedJson('plain string');
      expect(capturedOriginalJson).toHaveBeenCalledWith('plain string');

      wrappedJson(12345);
      expect(capturedOriginalJson).toHaveBeenCalledWith(12345);
    });

    it('does not call req.t when body has no error field', () => {
      mockReq.t = vi.fn();
      capturedOriginalJson.mockReturnValue(mockRes);

      errorTranslationInterceptor(mockReq, mockRes, mockNext);

      const wrappedJson = mockRes.json;
      wrappedJson({ data: [1, 2, 3], status: 'success' });

      expect(mockReq.t).not.toHaveBeenCalled();
    });

    it('does not call req.t when body.error is not a string', () => {
      mockReq.t = vi.fn();
      capturedOriginalJson.mockReturnValue(mockRes);

      errorTranslationInterceptor(mockReq, mockRes, mockNext);

      const wrappedJson = mockRes.json;
      wrappedJson({ error: { code: 'E001', details: 'Some error' } });

      expect(mockReq.t).not.toHaveBeenCalled();
    });

    it('sets body.error to undefined when req.t returns undefined', () => {
      mockReq.t = vi.fn().mockReturnValue(undefined);
      capturedOriginalJson.mockReturnValue(mockRes);

      errorTranslationInterceptor(mockReq, mockRes, mockNext);

      const wrappedJson = mockRes.json;
      const body = { error: 'SERVER_ERROR' };
      wrappedJson(body);

      expect(mockReq.t).toHaveBeenCalledWith('SERVER_ERROR', { defaultValue: 'SERVER_ERROR' });
      expect(body.error).toBeUndefined();
    });

    it('idempotently handles multiple res.json calls', () => {
      mockReq.t = vi.fn((key) => `Translated: ${key}`);
      capturedOriginalJson.mockReturnValue(mockRes);

      errorTranslationInterceptor(mockReq, mockRes, mockNext);

      const wrappedJson = mockRes.json;

      const body1 = { error: 'ERR_1' };
      wrappedJson(body1);
      expect(body1.error).toBe('Translated: ERR_1');

      const body2 = { error: 'ERR_2' };
      wrappedJson(body2);
      expect(body2.error).toBe('Translated: ERR_2');
    });

    it('handles null or undefined body passed to res.json gracefully', () => {
      mockReq.t = vi.fn();
      capturedOriginalJson.mockReturnValue(mockRes);

      errorTranslationInterceptor(mockReq, mockRes, mockNext);

      const wrappedJson = mockRes.json;
      expect(() => wrappedJson(null)).not.toThrow();
      expect(() => wrappedJson(undefined)).not.toThrow();
      expect(mockReq.t).not.toHaveBeenCalled();
    });

    it('handles empty string error correctly', () => {
      mockReq.t = vi.fn().mockReturnValue('Empty Error Translated');
      capturedOriginalJson.mockReturnValue(mockRes);

      errorTranslationInterceptor(mockReq, mockRes, mockNext);

      const wrappedJson = mockRes.json;
      const body = { error: '' };
      wrappedJson(body);

      expect(mockReq.t).toHaveBeenCalledWith('', { defaultValue: '' });
      expect(body.error).toBe('Empty Error Translated');
    });
  });
});
