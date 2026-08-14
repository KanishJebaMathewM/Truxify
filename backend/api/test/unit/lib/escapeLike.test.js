import { describe, it, expect } from 'vitest';
import { escapeLike, escapeSqlLike } from '../../../src/lib/escapeLike.js';

describe('escapeLike', () => {
  it('returns null/undefined as-is', () => {
    expect(escapeLike(null)).toBeNull();
    expect(escapeLike(undefined)).toBeUndefined();
  });

  it('converts non-string inputs to string before escaping', () => {
    expect(escapeLike(123)).toBe('123');
    expect(escapeLike(true)).toBe('true');
    expect(escapeLike({})).toBe('[object Object]');
  });

  it('escapes backslashes', () => {
    expect(escapeLike('path\\to')).toBe('path\\\\to');
  });

  it('escapes percent wildcards', () => {
    expect(escapeLike('100%')).toBe('100\\%');
  });

  it('escapes underscore wildcards', () => {
    expect(escapeLike('user_name')).toBe('user\\_name');
  });

  it('escapes all special characters in combination', () => {
    expect(escapeLike('50% off _every_ \\thing_')).toBe('50\\% off \\_every\\_ \\\\thing\\_');
  });

  it('leaves plain alphanumeric strings unchanged', () => {
    expect(escapeLike('hello world')).toBe('hello world');
  });
});

describe('escapeSqlLike', () => {
  it('returns null/undefined as-is', () => {
    expect(escapeSqlLike(null)).toBeNull();
    expect(escapeSqlLike(undefined)).toBeUndefined();
  });

  it('returns non-string values as-is', () => {
    expect(escapeSqlLike(123)).toBe(123);
    expect(escapeSqlLike(true)).toBe(true);
  });

  it('leaves empty strings unchanged', () => {
    expect(escapeSqlLike('')).toBe('');
  });

  it('escapes backslashes', () => {
    expect(escapeSqlLike('path\\to')).toBe('path\\\\to');
  });

  it('escapes percent wildcards', () => {
    expect(escapeSqlLike('100%')).toBe('100\\%');
  });

  it('escapes underscore wildcards', () => {
    expect(escapeSqlLike('user_name')).toBe('user\\_name');
  });

  it('escapes square brackets', () => {
    expect(escapeSqlLike('file[1].txt')).toBe('file\\[1\\].txt');
  });

  it('handles mixed special characters', () => {
    expect(escapeSqlLike('50%_off[2]\\here')).toBe('50\\%\\_off\\[2\\]\\\\here');
  });
});
