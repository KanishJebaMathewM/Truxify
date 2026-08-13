import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
let logger;
beforeEach(async () => {
  logger = (await import('../../src/middleware/logger.js')).default;
  vi.clearAllMocks();
});
describe('authFailureMonitor', () => {
  it('is a function', async () => {
    const mod = await import('../../src/middleware/authFailureMonitor.js');
    expect(typeof mod.default).toBe('function');
  });
});


// === Spec 4 test ===
import { describe, it, expect, vi } from 'vitest';
import { checkBoundOrFailClosed } from '../../src/middleware/authFailureMonitor.js';
describe('checkBoundOrFailClosed', () => {
  it('allows under limit', async () => {
    const r = { incr: vi.fn().mockResolvedValue(1) };
    expect((await checkBoundOrFailClosed(r, '1.2.3.4')).allowed).toBe(true);
  });
  it('denies when banned', async () => {
    const r = { incr: vi.fn().mockResolvedValue(10) };
    const out = await checkBoundOrFailClosed(r, '1.2.3.4', { maxAttempts: 5 });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('banned');
  });
});

