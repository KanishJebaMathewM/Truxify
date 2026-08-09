/**
 * Unit tests for backend/api/src/lib/orderDisplayId.js
 *
 * Run with:  npm run test:unit -- test/unit/orderDisplayId.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock crypto module before importing the module under test
vi.mock('crypto', () => ({
  default: {
    randomInt: vi.fn((max) => 0), // deterministic: always returns 0
  },
}));

const { generateOrderDisplayId, ORDER_DISPLAY_ID_MAX_RETRIES } = await import('../../src/lib/orderDisplayId.js');

describe('orderDisplayId', () => {
  describe('generateOrderDisplayId', () => {
    it('returns a string prefixed with #FF', () => {
      const id = generateOrderDisplayId();
      expect(typeof id).toBe('string');
      expect(id.startsWith('#FF')).toBe(true);
    });

    it('contains the current date in YYYYMMDD format', () => {
      const id = generateOrderDisplayId();
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      expect(id).toContain(dateStr);
    });

    it('has a total length of 23 characters (#FF + 8 date + 12 random)', () => {
      const id = generateOrderDisplayId();
      // #FF (3) + YYYYMMDD (8) + 12 random chars = 23
      expect(id.length).toBe(23);
    });

    it('contains exactly 12 random alphanumeric characters after the date', () => {
      const id = generateOrderDisplayId();
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const prefix = `#FF${dateStr}`;
      const randomPart = id.slice(prefix.length);
      expect(randomPart.length).toBe(12);
      // The mock returns 0 for randomInt, so all chars are index 0 = 'A'
      expect(randomPart).toBe('AAAAAAAAAAAA');
    });

    it('contains only valid characters from the alphabet (A-Z, 0-9)', () => {
      const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const id = generateOrderDisplayId();
      const randomPart = id.slice(3); // skip #FF and date
      for (const char of randomPart) {
        expect(ALPHABET).toContain(char);
      }
    });

    it('ORDER_DISPLAY_ID_MAX_RETRIES is defined and positive', () => {
      expect(ORDER_DISPLAY_ID_MAX_RETRIES).toBeGreaterThan(0);
      expect(typeof ORDER_DISPLAY_ID_MAX_RETRIES).toBe('number');
    });
  });
});
