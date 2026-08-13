import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before imports
const mockFs = vi.hoisted(() => ({
  readFileSync: vi.fn().mockReturnValue('{}'),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('i18next', () => ({
  default: {
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
  },
}));

vi.mock('i18next-http-middleware', () => ({
  default: {
    LanguageDetector: { type: 'languageDetector' },
    handle: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  __esModule: true,
  default: mockFs,
  ...mockFs,
}));

vi.mock('path', () => ({
  __esModule: true,
  default: { dirname: vi.fn(), join: vi.fn((...args) => args.join('/')) },
  dirname: vi.fn(),
  join: vi.fn((...args) => args.join('/')),
}));

vi.mock('url', () => ({
  __esModule: true,
  default: { fileURLToPath: vi.fn() },
  fileURLToPath: vi.fn(),
}));

vi.mock('../../src/tracing/tracing.js', () => ({
  getTracer: vi.fn(() => ({ startSpan: vi.fn() })),
  createSpan: vi.fn(),
  addAttributes: vi.fn(),
}));

import { errorTranslationInterceptor } from '../../src/middleware/i18n.js';

describe('i18n - errorTranslationInterceptor', () => {
  let mockReq;
  let mockRes;
  let mockNext;
  let capturedOriginalJson;

  beforeEach(() => {
    capturedOriginalJson = vi.fn();
    mockReq = {};
    mockNext = vi.fn();
    mockRes = {
      json: capturedOriginalJson,
    };
  });

  it('calls next immediately', () => {
    errorTranslationInterceptor(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('translates error string in res.json body', () => {
    const translated = 'Error traduce';
    mockReq.t = vi.fn().mockReturnValue(translated);
    capturedOriginalJson.mockReturnValue(mockRes);

    errorTranslationInterceptor(mockReq, mockRes, mockNext);

    const wrappedJson = mockRes.json;
    const body = { error: 'UNAUTHORIZED' };
    wrappedJson(body);

    expect(mockReq.t).toHaveBeenCalledWith('UNAUTHORIZED', { defaultValue: 'UNAUTHORIZED' });
    expect(body.error).toBe(translated);
  });

  it('does not call req.t when body has no error field', () => {
    mockReq.t = vi.fn();
    capturedOriginalJson.mockReturnValue(mockRes);

    errorTranslationInterceptor(mockReq, mockRes, mockNext);

    const wrappedJson = mockRes.json;
    wrappedJson({ data: [1, 2, 3] });

    expect(mockReq.t).not.toHaveBeenCalled();
  });

  it('does not call req.t when body.error is not a string', () => {
    mockReq.t = vi.fn();
    capturedOriginalJson.mockReturnValue(mockRes);

    errorTranslationInterceptor(mockReq, mockRes, mockNext);

    const wrappedJson = mockRes.json;
    wrappedJson({ error: { code: 'E001' } });

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
    // body.error is overwritten by the translated value (undefined)
    expect(body.error).toBeUndefined();
  });

  it('idempotently handles multiple res.json calls', () => {
    mockReq.t = vi.fn().mockReturnValue('Translated');
    capturedOriginalJson.mockReturnValue(mockRes);

    errorTranslationInterceptor(mockReq, mockRes, mockNext);

    const wrappedJson = mockRes.json;

    const body1 = { error: 'ERR_1' };
    wrappedJson(body1);
    expect(body1.error).toBe('Translated');

    const body2 = { error: 'ERR_2' };
    wrappedJson(body2);
    expect(body2.error).toBe('Translated');
  });
});
