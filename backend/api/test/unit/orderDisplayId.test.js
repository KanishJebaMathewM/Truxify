import { describe, it, expect } from 'vitest';
import {
  generateOrderDisplayId,
  isValidOrderDisplayId,
  parseDisplayId,
  ORDER_DISPLAY_ID_MAX_RETRIES,
} from '../../src/lib/orderDisplayId.js';

describe('generateOrderDisplayId', () => {
  it('returns a string prefixed with #FF', () => {
    const id = generateOrderDisplayId();
    expect(id.startsWith('#FF')).toBe(true);
  });

  it('returns a 22-character id (#FF + 8 date + 12 random)', () => {
    const id = generateOrderDisplayId();
    expect(id.length).toBe(22); // #FF + YYYYMMDD(8) + 12 random
  });

  it('returns a valid id per isValidOrderDisplayId', () => {
    const id = generateOrderDisplayId();
    expect(isValidOrderDisplayId(id)).toBe(true);
  });

  it('each call produces a different id', () => {
    const ids = new Set(Array.from({ length: 100 }, generateOrderDisplayId));
    expect(ids.size).toBe(100); // no collisions in 100 calls
  });
});

describe('isValidOrderDisplayId', () => {
  it('accepts a valid display id', () => {
    expect(isValidOrderDisplayId('#FF202608021234567890AB')).toBe(true);
  });

  it('rejects non-string input', () => {
    expect(isValidOrderDisplayId(null)).toBe(false);
    expect(isValidOrderDisplayId(123)).toBe(false);
    expect(isValidOrderDisplayId(undefined)).toBe(false);
  });

  it('rejects wrong prefix', () => {
    expect(isValidOrderDisplayId('#XX202608021234567890AB')).toBe(false);
  });

  it('rejects wrong date length', () => {
    expect(isValidOrderDisplayId('#FF2026081234567890AB')).toBe(false);
  });

  it('rejects lowercase letters', () => {
    expect(isValidOrderDisplayId('#FF20260812abcd567890ab')).toBe(false);
  });
});

describe('parseDisplayId', () => {
  it('returns valid:true for a correct id', () => {
    const id = '#FF202608021234567890AB';
    const result = parseDisplayId(id);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns valid:false for null', () => {
    expect(parseDisplayId(null)).toEqual({ valid: false, error: 'null input' });
  });

  it('returns valid:false for non-string', () => {
    expect(parseDisplayId(123)).toEqual({ valid: false, error: 'expected string, got number' });
  });

  it('returns valid:false for an invalid id', () => {
    const result = parseDisplayId('#BAD202608021234567890');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('ORDER_DISPLAY_ID_MAX_RETRIES', () => {
  it('is a positive integer', () => {
    expect(ORDER_DISPLAY_ID_MAX_RETRIES).toBeGreaterThan(0);
    expect(Number.isInteger(ORDER_DISPLAY_ID_MAX_RETRIES)).toBe(true);
  });
});
