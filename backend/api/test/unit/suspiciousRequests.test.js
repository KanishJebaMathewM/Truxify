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


// === Spec 6 test ===
import { describe, it, expect } from 'vitest';
import { sanitizeKey, sanitizeQueryParams } from '../../src/middleware/suspiciousRequests.js';
describe('sanitizeKey', () => {
  it('rejects __proto__', () => { expect(sanitizeKey('__proto__')).toBeNull(); });
  it('rejects constructor', () => { expect(sanitizeKey('constructor')).toBeNull(); });
  it('accepts normal', () => { expect(sanitizeKey('name')).toBe('name'); });
});
describe('sanitizeQueryParams', () => {
  it('strips dangerous', () => {
    expect(sanitizeQueryParams({ name: 'x', __proto__: 'y' })).toEqual({ name: 'x' });
  });
  it('null → {}', () => { expect(sanitizeQueryParams(null)).toEqual({}); });
});

