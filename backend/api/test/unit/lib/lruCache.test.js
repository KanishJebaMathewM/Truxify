import { describe, it, expect } from 'vitest';
import { clampMaxKeys } from '../../../src/lib/lruCache.js';

describe('clampMaxKeys', () => {
  it('returns fallback for non-finite inputs', () => {
    expect(clampMaxKeys(NaN)).toBe(1000);
    expect(clampMaxKeys(Infinity)).toBe(1000);
    expect(clampMaxKeys(-Infinity)).toBe(1000);
    expect(clampMaxKeys('abc')).toBe(1000);
    expect(clampMaxKeys(undefined)).toBe(1000);
  });

  it('treats null as 0 (finite) and clamps to MIN_KEYS', () => {
    // Number(null) === 0, which is finite but below MIN_KEYS (10)
    expect(clampMaxKeys(null)).toBe(10);
  });

  it('returns custom fallback when provided', () => {
    expect(clampMaxKeys(NaN, 500)).toBe(500);
    expect(clampMaxKeys(Infinity, 0)).toBe(0);
  });

  it('clamps values below MIN_KEYS (10) to 10', () => {
    expect(clampMaxKeys(-100)).toBe(10);
    expect(clampMaxKeys(0)).toBe(10);
    expect(clampMaxKeys(5)).toBe(10);
    expect(clampMaxKeys(9)).toBe(10);
    expect(clampMaxKeys(9.9)).toBe(10);
  });

  it('clamps values above MAX_KEYS (100000) to 100000', () => {
    expect(clampMaxKeys(100001)).toBe(100000);
    expect(clampMaxKeys(500000)).toBe(100000);
    expect(clampMaxKeys(1e9)).toBe(100000);
  });

  it('returns the value unchanged when within [10, 100000]', () => {
    expect(clampMaxKeys(10)).toBe(10);
    expect(clampMaxKeys(1000)).toBe(1000);
    expect(clampMaxKeys(50000)).toBe(50000);
    expect(clampMaxKeys(100000)).toBe(100000);
  });

  it('handles floating point numbers within range', () => {
    expect(clampMaxKeys(10.5)).toBe(10.5);
    expect(clampMaxKeys(99999.9)).toBe(99999.9);
  });
});
