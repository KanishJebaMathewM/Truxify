import { describe, it, expect } from 'vitest';
import { verifyPersistedQueryHash } from '../../persisted_queries.js';
import crypto from 'crypto';
describe('verifyPersistedQueryHash', () => {
  it('match', () => {
    const q = '{x}'; const h = crypto.createHash('sha256').update(q).digest('hex');
    expect(verifyPersistedQueryHash(q, h)).toBe(true);
  });
  it('mismatch', () => { expect(verifyPersistedQueryHash('x', 'a'.repeat(64))).toBe(false); });
});
