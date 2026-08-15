import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../../../../src/utils/cursorPagination.js';

describe('cursorPagination', () => {
  describe('encodeCursor', () => {
    it('encodes an object to base64 string', () => {
      const result = encodeCursor({ id: '123', ts: 1700000000 });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns empty string for null input', () => {
      expect(encodeCursor(null)).toBe('');
    });
  });

  describe('decodeCursor', () => {
    it('decodes back to original object', () => {
      const original = { id: 'abc', ts: 1700000000 };
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);
      expect(decoded.id).toBe(original.id);
      expect(decoded.ts).toBe(original.ts);
    });

    it('returns null for invalid cursor', () => {
      expect(decodeCursor('not-a-valid-cursor')).toBeNull();
    });
  });
});
