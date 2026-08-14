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
