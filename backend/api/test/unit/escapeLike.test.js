import { describe, it, expect } from 'vitest';
import { escapeLike } from '../../../src/lib/escapeLike.js';

describe('escapeLike', () => {
  it('escapes % wildcard', () => {
    expect(escapeLike('100%')).toBe('100\%');
  });

  it('escapes _ wildcard', () => {
    expect(escapeLike('user_name')).toBe('user\_name');
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
