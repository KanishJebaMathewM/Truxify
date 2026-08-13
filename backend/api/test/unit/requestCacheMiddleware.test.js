import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
let logger;
beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});
describe('requestCacheMiddleware', () => {
  it('is a function', async () => {
    const mod = await import('../../src/middleware/requestCacheMiddleware.js');
    expect(typeof mod.default).toBe('function');
  });

  it('also registers error and close listeners to clear the cache', () => {
    const mockRes = { once: vi.fn() };
    const mockNext = vi.fn();
    const mockReq = {};

    requestCacheMiddleware(mockReq, mockRes, mockNext);

    expect(mockRes.once).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockRes.once).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockNext).toHaveBeenCalled();
  });
});
