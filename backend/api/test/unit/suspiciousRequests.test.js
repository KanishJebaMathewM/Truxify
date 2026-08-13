import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
let logger;
beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});
describe('suspiciousRequests', () => {
  it('is a function', async () => {
    const mod = await import('../../src/middleware/suspiciousRequests.js');
    expect(typeof mod.default).toBe('function');
  });
});
