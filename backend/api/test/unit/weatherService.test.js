import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
let logger;
beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});
describe('weatherService', () => {
  it('is an object', async () => {
    const mod = await import('../../src/services/weatherService.js');
    expect(typeof mod).toBe('object');
  });
});
