import { describe, it, expect } from 'vitest';
import { escapeLike, escapeSqlLike } from '../../src/lib/escapeLike.js';

describe('escapeLike', () => {
  it('returns null/undefined unchanged', () => {
    expect(escapeLike(null)).toBeNull();
    expect(escapeLike(undefined)).toBeUndefined();
  });

  it('converts non-string values to string', () => {
    expect(escapeLike(42)).toBe('42');
    expect(escapeLike(true)).toBe('true');
  });

  it('escapes SQL LIKE wildcard characters', () => {
    expect(escapeLike('%')).toBe('\\%');
    expect(escapeLike('_')).toBe('\\_');
    expect(escapeLike('\\')).toBe('\\\\');
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('test_value')).toBe('test\\_value');
    expect(escapeLike('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('leaves plain strings unchanged', () => {
    expect(escapeLike('hello world')).toBe('hello world');
    expect(escapeLike('order-12345')).toBe('order-12345');
  });
});

describe('escapeSqlLike', () => {
  it('returns null/undefined unchanged', () => {
    expect(escapeSqlLike(null)).toBeNull();
    expect(escapeSqlLike(undefined)).toBeUndefined();
  });

  it('escapes SQL LIKE special characters', () => {
    expect(escapeSqlLike('[brackets]')).toBe('\\[brackets\\]');
    expect(escapeSqlLike('50%_disc[ount]')).toBe('50\\%\\_disc\\[ount\\]');
    expect(escapeSqlLike('path\\to')).toBe('path\\\\to');
  });

  it('leaves plain strings unchanged', () => {
    expect(escapeSqlLike('normal-text')).toBe('normal-text');
  });
});
