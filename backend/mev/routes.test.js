import { describe, it, expect } from 'vitest';
import { recoverSender } from '../../routes.js';
describe('recoverSender', () => {
  it('invalid sig', () => { expect(recoverSender('x', '0xbad')).toBeNull(); });
  it('shape', () => { const r = recoverSender('h', '0x' + 'ab'.repeat(65)); expect(r === null || typeof r === 'string').toBe(true); });
});
