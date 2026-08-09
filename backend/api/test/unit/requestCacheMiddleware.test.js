import { describe, it, expect, vi } from 'vitest';
import { requestCacheMiddleware } from '../../src/middleware/requestCacheMiddleware.js';

describe('requestCacheMiddleware', () => {
  it('runs requestContext and attaches finish listener to clear cache', () => {
    let finishCallback;
    const mockRes = {
      once: vi.fn((event, cb) => {
        if (event === 'finish') finishCallback = cb;
      }),
    };
    const mockNext = vi.fn();
    const mockReq = {};

    requestCacheMiddleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.once).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(typeof finishCallback).toBe('function');
  });
});
