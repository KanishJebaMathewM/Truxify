import { describe, it, expect, vi } from 'vitest';

// flashbots_relayer.js instantiates its relayer at module scope and throws
// without this key — pin a dummy before the static import chain loads.
vi.hoisted(() => {
  process.env.RELAYER_WALLET_PRIVATE_KEY = '0x' + '1'.repeat(64);
});
import { commitHash, verifyReveal } from './mev.service.js';
describe('commit-reveal', () => {
  it('roundtrip', () => { expect(verifyReveal(commitHash('s', { a: 1 }), 's', { a: 1 })).toBe(true); });
  it('wrong', () => { expect(verifyReveal(commitHash('a', {}), 'b', {})).toBe(false); });
});
