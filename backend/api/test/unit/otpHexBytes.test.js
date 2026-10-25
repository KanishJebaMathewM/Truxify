import { describe, it, expect } from 'vitest';
import { constantTimeEqualHex } from '../../src/lib/otpHashing.js';

describe('hex equality requires complete bytes', () => {
  it.each([
    ['a', 'b'], ['ab0', 'ab1'], ['abcd0', 'abcd'],
    ['abcd', 'abcd0'], ['0', ''], ['', '0'], ['abc', 'abc'],
  ])('rejects incomplete byte encodings %s / %s', (a, b) => {
    expect(constantTimeEqualHex(a, b)).toBe(false);
  });

  it('preserves complete-byte case normalization', () => {
    expect(constantTimeEqualHex('aBcD00', 'AbcD00')).toBe(true);
    expect(constantTimeEqualHex('abcd00', 'abcd01')).toBe(false);
    expect(constantTimeEqualHex('abcd', 'abcd00')).toBe(false);
  });

  it('preserves the empty byte sequence contract', () => {
    expect(constantTimeEqualHex('', '')).toBe(true);
  });
});
