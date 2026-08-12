import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
let logger;
beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});
describe('headerSizeMonitor', () => {
  it('is a function', async () => {
    const mod = await import('../../src/middleware/headerSizeMonitor.js');
    expect(typeof mod.default).toBe('function');
  });
});
