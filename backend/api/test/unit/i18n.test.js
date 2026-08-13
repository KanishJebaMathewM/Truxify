import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
let logger;
beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});
describe('i18n', () => {
  it('is a function', async () => {
    const mod = await import('../../src/middleware/i18n.js');
    expect(typeof mod.default).toBe('function');
  });

  it('passes a non-object body through unchanged', () => {
    mockReq.t = vi.fn();
    capturedOriginalJson.mockReturnValue(mockRes);
    errorTranslationInterceptor(mockReq, mockRes, mockNext);
    const wrappedJson = mockRes.json;
    const arr = ['a', 'b'];
    wrappedJson(arr);
    expect(arr).toEqual(['a', 'b']);
    expect(mockReq.t).not.toHaveBeenCalled();
  });
});
