import { describe, it, expect } from 'vitest';
import {
  generateOrderDisplayId,
  isValidOrderDisplayId,
  parseDisplayId,
  ORDER_DISPLAY_ID_MAX_RETRIES,
} from '../../../src/lib/orderDisplayId.js';

describe('generateOrderDisplayId', () => {
  it('returns a string prefixed with #FF', () => {
    const id = generateOrderDisplayId();
    expect(id.startsWith('#FF')).toBe(true);
  });

  it('contains a date in YYYYMMDD format', () => {
    const id = generateOrderDisplayId();
    const datePart = id.slice(3, 11);
    expect(datePart).toMatch(/^\d{8}$/);
    const year = parseInt(datePart.slice(0, 4), 10);
    const month = parseInt(datePart.slice(4, 6), 10);
    const day = parseInt(datePart.slice(6, 8), 10);
    expect(year).toBeGreaterThanOrEqual(2020);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });

  it('contains 12 random alphanumeric characters after the date', () => {
    const id = generateOrderDisplayId();
    const randomPart = id.slice(11);
    expect(randomPart).toHaveLength(12);
    expect(randomPart).toMatch(/^[A-Z0-9]{12}$/);
  });

  it('generates unique IDs on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateOrderDisplayId()));
    expect(ids.size).toBe(100);
  });

  it('has correct total length (prefix + date + random)', () => {
    const id = generateOrderDisplayId();
    expect(id).toHaveLength(3 + 8 + 12); // #FF + YYYYMMDD + 12 chars = 23
  });
});

describe('isValidOrderDisplayId', () => {
  it('returns true for valid display ids', () => {
    expect(isValidOrderDisplayId('#FF20260814ABC123DEF456')).toBe(true);
    expect(isValidOrderDisplayId('#FF20260101ZZZZZZZZZZZZ')).toBe(true);
  });

  it('returns false for non-string input', () => {
    expect(isValidOrderDisplayId(null)).toBe(false);
    expect(isValidOrderDisplayId(undefined)).toBe(false);
    expect(isValidOrderDisplayId(123)).toBe(false);
    expect(isValidOrderDisplayId({})).toBe(false);
  });

  it('returns false for wrong prefix', () => {
    expect(isValidOrderDisplayId('#XX20260814ABC123DEF456')).toBe(false);
    expect(isValidOrderDisplayId('FF20260814ABC123DEF456')).toBe(false);
  });

  it('returns false for wrong length', () => {
    expect(isValidOrderDisplayId('#FF20260814ABC123')).toBe(false);  // too short
    expect(isValidOrderDisplayId('#FF20260814ABC123DEF456XYZ')).toBe(false); // too long
  });

  it('accepts any 8-digit date-like string (format-only validation)', () => {
    // The function only validates format, not calendar validity
    expect(isValidOrderDisplayId('#FF20261332ABC123DEF456')).toBe(true);
  });

  it('returns false for lowercase letters in random part', () => {
    expect(isValidOrderDisplayId('#FF20260814abc123def456')).toBe(false);
  });

  it('returns false for special characters', () => {
    expect(isValidOrderDisplayId('#FF20260814ABC123DEF45!')).toBe(false);
    expect(isValidOrderDisplayId('#FF20260814ABC123DEF45_')).toBe(false);
  });
});

describe('parseDisplayId', () => {
  it('returns valid: true for valid display ids', () => {
    const result = parseDisplayId('#FF20260814ABC123DEF456');
    expect(result.valid).toBe(true);
    expect(result.displayId).toBe('#FF20260814ABC123DEF456');
  });

  it('returns valid: false for null', () => {
    expect(parseDisplayId(null).valid).toBe(false);
    expect(parseDisplayId(null).error).toBe('null input');
  });

  it('returns valid: false for non-string', () => {
    expect(parseDisplayId(123).valid).toBe(false);
    expect(parseDisplayId(123).error).toContain('string');
  });

  it('returns valid: false for invalid format', () => {
    expect(parseDisplayId('INVALID').valid).toBe(false);
    expect(parseDisplayId('INVALID').error).toBe('Invalid order display id format');
  });
});

describe('ORDER_DISPLAY_ID_MAX_RETRIES', () => {
  it('is set to 5', () => {
    expect(ORDER_DISPLAY_ID_MAX_RETRIES).toBe(5);
  });
});
