import { describe, it, expect } from 'vitest';
import { escapeLike } from '../../src/lib/escapeLike.js';

describe('escapeLike', () => {
  it('returns non-string inputs unchanged', () => {
    expect(escapeLike(null)).toBe(null);
    expect(escapeLike(undefined)).toBe(undefined);
    expect(escapeLike(42)).toBe(42);
    expect(escapeLike(true)).toBe(true);
    expect(escapeLike({ foo: 'bar' })).toEqual({ foo: 'bar' });
  });

  it('escapes backslashes', () => {
    expect(escapeLike('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes percent signs used in LIKE wildcards', () => {
    expect(escapeLike('hello%world')).toBe('hello\\%world');
  });

  it('escapes underscores used in LIKE wildcards', () => {
    expect(escapeLike('user_name')).toBe('user\\_name');
  });

  it('escapes all three special characters together', () => {
    expect(escapeLike('50%_test\\value')).toBe('50\\%\\_test\\\\value');
  });

  it('handles empty strings', () => {
    expect(escapeLike('')).toBe('');
  });

  it('handles consecutive wildcards and backslashes', () => {
    expect(escapeLike('%%%___\\\\')).toBe('\\%\\%\\%\\_\\_\\_\\\\\\\\');
  });

  it('returns the same string when no special chars are present', () => {
    expect(escapeLike('normal text here')).toBe('normal text here');
  });

  it('returns a string type for a string input', () => {
    const result = escapeLike('test');
    expect(typeof result).toBe('string');
  });
});
