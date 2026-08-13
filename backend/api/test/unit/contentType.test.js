import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
let logger;
beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});
describe('contentType', () => {
  it('is a function', async () => {
    const mod = await import('../../src/middleware/contentType.js');
    expect(typeof mod.default).toBe('function');
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
});
