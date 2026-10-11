import { describe, it, expect } from 'vitest';
import { escapeLike } from '../../src/lib/escapeLike.js';

describe('escapeLike utility', () => {
  describe('escapeLike', () => {
    it('returns null and undefined as is', () => {
      expect(escapeLike(null)).toBeNull();
      expect(escapeLike(undefined)).toBeUndefined();
    });

    it('returns empty string as is', () => {
      expect(escapeLike('')).toBe('');
    });

    it('returns normal strings without special characters as is', () => {
      expect(escapeLike('hello world')).toBe('hello world');
      expect(escapeLike('café')).toBe('café');
    });

    it('casts non-string inputs to strings', () => {
      expect(escapeLike(123)).toBe('123');
      expect(escapeLike(0)).toBe('0');
      expect(escapeLike(false)).toBe('false');
    });
    it('escapes %, _, and \\', () => {
      expect(escapeLike('100%')).toBe('100\\%');
      expect(escapeLike('a_b')).toBe('a\\_b');
      expect(escapeLike('a\\b')).toBe('a\\\\b');
    });

    it('handles combinations and edge cases', () => {
      expect(escapeLike('user%100_name\\path')).toBe('user\\%100\\_name\\\\path');
      expect(escapeLike('a\\\\b')).toBe('a\\\\\\\\b');
      expect(escapeLike('%\\_')).toBe('\\%\\\\\\_');
      expect(escapeLike('[test]')).toBe('[test]');
    });
  });

});
