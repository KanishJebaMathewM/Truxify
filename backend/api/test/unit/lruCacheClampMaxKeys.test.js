import { describe, it, expect } from 'vitest';
import { clampMaxKeys } from '../../../src/lib/lruCache.js';

describe('clampMaxKeys', () => {
  it('returns exact MIN_KEYS boundary', () => {
    expect(clampMaxKeys(10)).toBe(10);
  });

  it('returns exact MAX_KEYS boundary', () => {
    expect(clampMaxKeys(100_000)).toBe(100_000);
  });

  it('returns MIN_KEYS when input is below minimum', () => {
    expect(clampMaxKeys(5)).toBe(10);
    expect(clampMaxKeys(0)).toBe(10);
    expect(clampMaxKeys(-1)).toBe(10);
  });

  it('returns MAX_KEYS when input is above maximum', () => {
    expect(clampMaxKeys(200_000)).toBe(100_000);
  });

  it('returns NaN fallback when given undefined fallback', () => {
    // When fallback is explicitly undefined, the function's own default (1000) should apply
    expect(clampMaxKeys(NaN, undefined)).toBe(1000);
  });

  it('returns NaN when input is NaN and fallback is NaN', () => {
    expect(Number.isNaN(clampMaxKeys(NaN, NaN))).toBe(true);
  });

  it('returns fallback when input is non-finite and fallback is finite', () => {
    expect(clampMaxKeys(NaN, 500)).toBe(500);
    expect(clampMaxKeys(Infinity, 500)).toBe(500);
    expect(clampMaxKeys(-Infinity, 500)).toBe(500);
  });

  it('returns input as-is when within bounds', () => {
    expect(clampMaxKeys(500)).toBe(500);
    expect(clampMaxKeys(50_000)).toBe(50_000);
  });

  it('returns custom fallback when provided and input is invalid', () => {
    expect(clampMaxKeys('abc', 2000)).toBe(2000);
    expect(clampMaxKeys(null, 2000)).toBe(2000);
  });
});
