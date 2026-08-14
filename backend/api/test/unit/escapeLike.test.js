import { describe, it, expect } from 'vitest';
import { escapeLike, escapeSqlLike } from '../../src/lib/escapeLike.js';

describe('escapeLike', () => {
  it('escapes % wildcard', () => {
    expect(escapeLike('100%')).toBe('100\\%');
  });

  it('escapes _ wildcard', () => {
    expect(escapeLike('user_name')).toBe('user\\_name');
  });

  it('escapes backslash', () => {
    expect(escapeLike('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('leaves plain strings unchanged', () => {
    expect(escapeLike('normaltext')).toBe('normaltext');
  });

  it('handles empty string', () => {
    expect(escapeLike('')).toBe('');
  });

  it('escapes multiple special characters in correct order', () => {
    expect(escapeLike('user%100_name\\path')).toBe('user\\%100\\_name\\\\path');
  });

  it('escapes consecutive backslashes', () => {
    expect(escapeLike('a\\\\b')).toBe('a\\\\\\\\b');
  });

  it('returns null for null input', () => {
    expect(escapeLike(null)).toBeNull();
  });

  it('returns undefined for undefined input', () => {
    expect(escapeLike(undefined)).toBeUndefined();
  });

  it('converts non-string inputs to string', () => {
    expect(escapeLike(42)).toBe('42');
    expect(escapeLike(true)).toBe('true');
  });
});

describe('escapeSqlLike', () => {
  it('escapes backslash', () => {
    expect(escapeSqlLike('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes % wildcard', () => {
    expect(escapeSqlLike('100%')).toBe('100\\%');
  });

  it('escapes _ wildcard', () => {
    expect(escapeSqlLike('user_name')).toBe('user\\_name');
  });

  it('escapes square brackets', () => {
    expect(escapeSqlLike('test[1]')).toBe('test\\[1\\]');
  });

  it('leaves plain strings unchanged', () => {
    expect(escapeSqlLike('normaltext')).toBe('normaltext');
  });

  it('handles empty string', () => {
    expect(escapeSqlLike('')).toBe('');
  });

  it('returns null for null input', () => {
    expect(escapeSqlLike(null)).toBeNull();
  });

  it('returns undefined for undefined input', () => {
    expect(escapeSqlLike(undefined)).toBeUndefined();
  });

  it('converts non-string inputs to string', () => {
    expect(escapeSqlLike(42)).toBe('42');
    expect(escapeSqlLike(true)).toBe('true');
  });

  it('escapes mixed special characters correctly', () => {
    expect(escapeSqlLike('a%b_c\\d[e]f')).toBe('a\\%b\\_c\\\\d\\[e\\]f');
  });

  it('escapes consecutive backslashes correctly', () => {
    // Each input backslash should be doubled in the output
    const result = escapeSqlLike('test\\\\end');
    expect(result).toBe('test\\\\\\\\end');
  });
});

describe('escapeLike and escapeSqlLike - additional coverage', () => {
  it('escapeLike handles unicode characters', () => {
    expect(escapeLike('hello world')).toBe('hello world');
    expect(escapeLike('café')).toBe('café');
  });

  it('escapeSqlLike handles unicode characters', () => {
    expect(escapeSqlLike('hello world')).toBe('hello world');
    expect(escapeSqlLike('café')).toBe('café');
  });

  it('escapeLike and escapeSqlLike produce different outputs', () => {
    // escapeSqlLike handles [] as well, escapeLike does not
    expect(escapeLike('[test]')).toBe('[test]');
    expect(escapeSqlLike('[test]')).toBe('\\[test\\]');
  });
});
