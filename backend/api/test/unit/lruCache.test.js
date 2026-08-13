import { describe, it, expect } from 'vitest';
import { clampMaxKeys } from '../../src/lib/lruCache.js';
describe('clampMaxKeys', () => {
  it('null → fallback', () => { expect(clampMaxKeys(null)).toBe(1000); });
  it('0 → 10', () => { expect(clampMaxKeys(0)).toBe(10); });
  it('over → 100000', () => { expect(clampMaxKeys(1_000_000)).toBe(100_000); });
  it('valid passes', () => { expect(clampMaxKeys(500)).toBe(500); });
});
