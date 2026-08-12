import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
let logger;
beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});
describe('hppProtection', () => {
  it('is a function', async () => {
    const mod = await import('../../src/middleware/hppProtection.js');
    expect(typeof mod.default).toBe('function');
  });

  it('flattens a nested array query value to a single scalar', () => {
    const req = makeReq({ page: [['2', '3'], '4'] });
    const res = makeRes();
    const next = vi.fn();
    hppProtection(req, res, next);
    expect(req.query.page).toBe('2');
    expect(Array.isArray(req.query.page)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ duplicateParams: ['page'] }),
      'Potential HTTP Parameter Pollution detected'
    );
  });
});
