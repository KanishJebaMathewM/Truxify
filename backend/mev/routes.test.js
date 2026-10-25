import { describe, it, expect, vi } from 'vitest';

// flashbots_relayer.js instantiates its relayer at module scope and throws
// without this key — pin a dummy before the static import chain loads.
vi.hoisted(() => {
  process.env.RELAYER_WALLET_PRIVATE_KEY = '0x' + '1'.repeat(64);
});
import { recoverSender } from './routes.js';
describe('recoverSender', () => {
  it('invalid sig', () => { expect(recoverSender('x', '0xbad')).toBeNull(); });
  it('shape', () => { const r = recoverSender('h', '0x' + 'ab'.repeat(65)); expect(r === null || typeof r === 'string').toBe(true); });
});
