import { describe, it, expect } from 'vitest';
import { escapeLike, escapeSqlLike } from '../../src/lib/escapeLike.js';

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

  describe('escapeSqlLike', () => {
    it('returns null and undefined as is', () => {
      expect(escapeSqlLike(null)).toBeNull();
      expect(escapeSqlLike(undefined)).toBeUndefined();
    });

    it('returns empty string as is', () => {
      expect(escapeSqlLike('')).toBe('');
    });

    it('returns normal strings without special characters as is', () => {
      expect(escapeSqlLike('hello world')).toBe('hello world');
      expect(escapeSqlLike('café')).toBe('café');
    });

    it('casts non-string inputs to strings', () => {
      expect(escapeSqlLike(123)).toBe('123');
      expect(escapeSqlLike(0)).toBe('0');
      expect(escapeSqlLike(false)).toBe('false');
    });

    it('escapes %, _, \\, [, and ]', () => {
      expect(escapeSqlLike('100%')).toBe('100\\%');
      expect(escapeSqlLike('a_b')).toBe('a\\_b');
      expect(escapeSqlLike('a\\b')).toBe('a\\\\b');
      expect(escapeSqlLike('test[1]')).toBe('test\\[1\\]');
      expect(escapeSqlLike(']start[')).toBe('\\]start\\[');
    });

    it('handles combinations and edge cases deterministically', () => {
      const input = '%%__[x]\\_%_[]_\\%__';
      expect(escapeSqlLike(input)).toBe('\\%\\%\\_\\_\\[x\\]\\\\\\_\\%\\_\\[\\]\\_\\\\\\%\\_\\_');
      expect(escapeSqlLike('a%b_c\\d[e]f')).toBe('a\\%b\\_c\\\\d\\[e\\]f');
      expect(escapeSqlLike('test\\\\end')).toBe('test\\\\\\\\end');
      expect(escapeSqlLike('\\%_[]')).toBe('\\\\\\%\\_\\[\\]');
    });
  });
});