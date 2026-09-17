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

  it('leaves nullish and undefined values as-is during escapeLike', () => {
    expect(escapeLike(null)).toBeNull();
    expect(escapeLike(undefined)).toBeUndefined();
    expect(escapeLike('')).toBe('');
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
    const result = escapeSqlLike('test\\\\end');
    expect(result).toBe('test\\\\\\\\end');
  });

  it('preserves null when preserveNull semantics are expected', () => {
    expect(escapeSqlLike(null)).toBeNull();
    expect(escapeSqlLike(undefined)).toBeUndefined();
    expect(escapeSqlLike('')).toBe('');
  });

  it('escapes backslash before percent and underscore when sequence order matters', () => {
    expect(escapeSqlLike('\\%_[]')).toBe('\\\\\\%\\_\\[\\]');
    expect(escapeSqlLike('user\\%_name')).toBe('user\\\\\\%\\_name');
  });

  it('handles sequences of special SQL LIKE characters in a single string', () => {
    const value = 'a\\b%c_d[e]f[g]h%i_j';
    expect(escapeSqlLike(value)).toBe('a\\\\b\\%c\\_d\\[e\\]f\\[g\\]h\\%i\\_j');
  });

  it('escapes bracket characters without disturbing adjacent text', () => {
    expect(escapeSqlLike('[abc]')).toBe('\\[abc\\]');
    expect(escapeSqlLike('prefix[1]suffix')).toBe('prefix\\[1\\]suffix');
    expect(escapeSqlLike(']start[')).toBe('\\]start\\[');
  });

  it('handles nested and repeated special characters deterministically', () => {
    expect(escapeSqlLike('%%__\\\\[]')).toBe('\\%\\%\\_\\_\\\\\\\\\\[\\]');
    expect(escapeSqlLike('[]%_\\')).toBe('\\[\\]\\%\\_\\\\');
  });

  it('keeps ordinary text exactly stable when no wildcard is present', () => {
    expect(escapeSqlLike('order-42_ref-7')).toBe('order-42\\_ref-7');
    expect(escapeSqlLike('alpha-beta.gamma')).toBe('alpha-beta.gamma');
  });

  it('handles repeated escaping across mixed character classes', () => {
    const value = 'x\\%_[]|%\\_';
    expect(escapeSqlLike(value)).toBe('x\\\\\\%\\_\\[\\]|\\%\\\\\\_');
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
    expect(escapeLike('[test]')).toBe('[test]');
    expect(escapeSqlLike('[test]')).toBe('\\[test\\]');
  });
it('returns the input unchanged for nullish values in both functions', () => {
    expect(escapeLike(null)).toBeNull();
    expect(escapeSqlLike(null)).toBeNull();
    expect(escapeLike(undefined)).toBeUndefined();
    expect(escapeSqlLike(undefined)).toBeUndefined();
  });

  it('handles a large number of mixed wildcard escapes in the same string', () => {
    const input = '%%__[x]\_%_[]_\%__';
    expect(escapeSqlLike(input)).toBe('\\%\\%\\_\\_\\[x\\]\\_\\%\\_\\[\\]\\_\\\\\\%\\_\\_');
  });

  it('maintains predictable escaping for trailing and leading wildcard markers', () => {
    expect(escapeSqlLike('%abc')).toBe('\\%abc');
    expect(escapeSqlLike('_abc')).toBe('\\_abc');
    expect(escapeSqlLike('abc%')).toBe('abc\\%');
    expect(escapeSqlLike('abc_')).toBe('abc\\_');
  });

  it('treats backslashes as escapes before percent and underscores in a stable order', () => {
    const value = '\\%_';
    expect(escapeSqlLike(value)).toBe('\\\\\\%\\_');
  });

  it('keeps nullish and empty strings distinct when escaping SQL LIKE values', () => {
    expect(escapeSqlLike(null)).toBeNull();
    expect(escapeSqlLike(undefined)).toBeUndefined();
    expect(escapeSqlLike('')).toBe('');
  });

  it('escapes a lone backslash in both helpers', () => {
    expect(escapeLike('\\')).toBe('\\\\');
    expect(escapeSqlLike('\\')).toBe('\\\\');
  });

  it('escapes wildcard characters next to bracket boundaries', () => {
    expect(escapeSqlLike('[%]')).toBe('\\[\\%\\]');
    expect(escapeSqlLike('[_]')).toBe('\\[\\_\\]');
  });

  it('preserves ordinary text around repeated wildcard sequences', () => {
    expect(escapeSqlLike('left%%middle__right')).toBe(
      'left\\%\\%middle\\_\\_right',
    );
  });

  it('coerces numeric and boolean values consistently', () => {
    expect(escapeLike(0)).toBe('0');
    expect(escapeSqlLike(0)).toBe('0');
    expect(escapeLike(false)).toBe('false');
    expect(escapeSqlLike(false)).toBe('false');
  });

  it('does not alter already escaped output when called once more', () => {
    const input = '100%_done';
    const escaped = escapeSqlLike(input);
    expect(escaped).toBe('100\\%\\_done');
    expect(escapeSqlLike(escaped)).toBe('100\\\\\\%\\\\\\_done');
  });

  it('should handle complex mixed wildcards and brackets', () => {
    expect(escapeSqlLike('user_%[test]\\1')).toBe('user\\_\\%\\[test\\]\\\\1');
  });

  it('should handle complex nested wildcard and bracket combinations (% _ [ ] \\)', () => {
    const input = 'user_%[test]\\100%_admin[root]';
    const expected = 'user\\_\\%\\[test\\]\\\\100\\%\\_admin\\[root\\]';
    expect(escapeSqlLike(input)).toBe(expected);
  });
});

describe('escapeLike and escapeSqlLike - backslash escape character', () => {
  it('escapeLike escapes a lone backslash', () => {
    expect(escapeLike('\\')).toBe('\\\\');
  });

  it('escapeLike escapes backslash before the % wildcard', () => {
    expect(escapeLike('\\%')).toBe('\\\\\\%');
  });

  it('escapeLike escapes backslash before the _ wildcard', () => {
    expect(escapeLike('a\\_b')).toBe('a\\\\\\_b');
  });

  it('escapeLike escapes backslashes inside plain text', () => {
    expect(escapeLike('\\a\\b')).toBe('\\\\a\\\\b');
  });

  it('escapeLike escapes backslash combined with both wildcards', () => {
    expect(escapeLike('%\\_')).toBe('\\%\\\\\\_');
  });

  it('escapeSqlLike escapes a lone backslash', () => {
    expect(escapeSqlLike('\\')).toBe('\\\\');
  });

  it('escapeSqlLike escapes backslash inside square brackets', () => {
    expect(escapeSqlLike('[\\]')).toBe('\\[\\\\\\]');
  });
});