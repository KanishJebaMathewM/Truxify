import { describe, it, expect } from 'vitest';
import { escapeLike } from '../../src/lib/escapeLike.js';

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

  it('handles unicode characters', () => {
    expect(escapeLike('hello world')).toBe('hello world');
    expect(escapeLike('café')).toBe('café');
  });
});