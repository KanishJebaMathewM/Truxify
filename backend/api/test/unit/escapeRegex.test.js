import { describe, expect, it } from 'vitest';
import { escapeRegExp } from '../../src/lib/escapeRegex.js';

describe('escapeRegExp', () => {
  it('escapes every regex metacharacter', () => {
    expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('escaped output is a literal-match regex', () => {
    const hostile = '.*(x|y)+$';
    const re = new RegExp(escapeRegExp(hostile));
    expect(re.test('.*(x|y)+$')).toBe(true);
    expect(re.test('axy')).toBe(false, 'metacharacters must not take effect');
  });

  it('plain strings pass through unchanged', () => {
    expect(escapeRegExp('Delhi-Mumbai 22 tonnes')).toBe('Delhi-Mumbai 22 tonnes');
  });

  it('non-string input returns empty string (no throw)', () => {
    expect(escapeRegExp(null)).toBe('');
    expect(escapeRegExp(42)).toBe('');
    expect(escapeRegExp(undefined)).toBe('');
  });

  it('prevents ReDoS-shaped input from acting as a pattern', () => {
    const evil = '(a+)+$';
    const re = new RegExp('^' + escapeRegExp(evil) + '$');
    const start = Date.now();
    expect(re.test(evil)).toBe(true);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
