import { describe, it, expect } from 'vitest';
import { commitHash, verifyReveal } from '../../mev.service.js';
describe('commit-reveal', () => {
  it('roundtrip', () => { expect(verifyReveal(commitHash('s', { a: 1 }), 's', { a: 1 })).toBe(true); });
  it('wrong', () => { expect(verifyReveal(commitHash('a', {}), 'b', {})).toBe(false); });
});
