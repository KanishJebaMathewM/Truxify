import { describe, it, expect } from 'vitest';
import { clampMaxKeys, MIN_KEYS, MAX_KEYS } from '../../src/lib/lruCache.js';

describe('lruCache clampMaxKeys', () => {
  it('returns the minimum allowed value for values below the lower bound', () => {
    expect(clampMaxKeys(0)).toBe(MIN_KEYS);
    expect(clampMaxKeys(-25)).toBe(MIN_KEYS);
    expect(clampMaxKeys(9)).toBe(MIN_KEYS);
  });

  it('returns the maximum allowed value for values above the upper bound', () => {
    expect(clampMaxKeys(100001)).toBe(MAX_KEYS);
    expect(clampMaxKeys(999999)).toBe(MAX_KEYS);
    expect(clampMaxKeys(Number.POSITIVE_INFINITY)).toBe(MAX_KEYS);
  });

  it('returns the value unchanged when it is within the valid range', () => {
    expect(clampMaxKeys(10)).toBe(10);
    expect(clampMaxKeys(25)).toBe(25);
    expect(clampMaxKeys(5000)).toBe(5000);
    expect(clampMaxKeys(100000)).toBe(100000);
  });

  it('returns the fallback when a non-finite value is provided', () => {
    expect(clampMaxKeys(Number.NaN, 1000)).toBe(1000);
    expect(clampMaxKeys(Number.NaN)).toBe(1000);
    expect(clampMaxKeys(undefined, 2000)).toBe(2000);
  });

  it('handles Infinity and NaN as expected', () => {
    expect(clampMaxKeys(Number.NEGATIVE_INFINITY)).toBe(MIN_KEYS);
    expect(clampMaxKeys(Number.POSITIVE_INFINITY)).toBe(MAX_KEYS);
    expect(clampMaxKeys(Number.NaN, 2500)).toBe(2500);
  });

  it('uses the default fallback for non-finite fallback values', () => {
    expect(clampMaxKeys(Number.NaN, Number.POSITIVE_INFINITY)).toBe(1000);
    expect(clampMaxKeys(Number.NaN, Number.NEGATIVE_INFINITY)).toBe(1000);
  });

  it('safely handles unusual inputs like Symbol and objects without throwing', () => {
    expect(clampMaxKeys(Symbol('test'), 1000)).toBe(1000);
    const objWithThrowingValueOf = {
      valueOf: () => {
        throw new Error('Conversion error');
      }
    };
    expect(clampMaxKeys(objWithThrowingValueOf, 2000)).toBe(2000);
    expect(clampMaxKeys('25')).toBe(25);
    expect(clampMaxKeys(null)).toBe(MIN_KEYS);
  });
});
