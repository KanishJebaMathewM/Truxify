import { describe, it, expect } from 'vitest';
import { generateOrderDisplayId, validateOrderDisplayId } from '../../../src/lib/orderDisplayId.js';

describe('orderDisplayId.js', () => {
  describe('generateOrderDisplayId', () => {
    it('generates a non-empty string', () => {
      const id = generateOrderDisplayId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateOrderDisplayId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('validateOrderDisplayId', () => {
    it('returns true for generated ID', () => {
      const id = generateOrderDisplayId();
      expect(validateOrderDisplayId(id)).toBe(true);
    });

    it('returns false for invalid format', () => {
      expect(validateOrderDisplayId('')).toBe(false);
      expect(validateOrderDisplayId(null)).toBe(false);
      expect(validateOrderDisplayId(undefined)).toBe(false);
    });
  });
});

describe('orderDisplayId - additional edge cases', () => {
  it('date component matches current date', () => {
    const id = generateOrderDisplayId();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(id).toContain(today);
  });

  it('parseDisplayId extracts date from valid id', () => {
    const result = parseDisplayId('#FF202608021234567890AB');
    expect(result.valid).toBe(true);
  });
});
