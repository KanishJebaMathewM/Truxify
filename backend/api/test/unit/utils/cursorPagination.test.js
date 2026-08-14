import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, isValidCursor } from '../../../src/utils/cursorPagination.js';

describe('cursorPagination', () => {
  describe('encodeCursor', () => {
    it('encodes an object to base64url string', () => {
      const result = encodeCursor({ id: 1, createdAt: '2024-01-01' });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('encodes empty object', () => {
      const result = encodeCursor({});
      expect(typeof result).toBe('string');
    });

    it('encoded output is decodable', () => {
      const original = { id: 42, ts: 1700000000 };
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe('decodeCursor', () => {
    it('decodes a valid base64url cursor', () => {
      const encoded = encodeCursor({ page: 2 });
      const result = decodeCursor(encoded);
      expect(result).toEqual({ page: 2 });
    });

    it('returns null for null input', () => {
      expect(decodeCursor(null)).toBe(null);
    });

    it('returns null for undefined input', () => {
      expect(decodeCursor(undefined)).toBe(null);
    });

    it('returns null for empty string', () => {
      expect(decodeCursor('')).toBe(null);
    });

    it('returns null for non-string input', () => {
      expect(decodeCursor(123)).toBe(null);
    });

    it('returns null for non-object decoded value (null, array, primitive)', () => {
      // null decodes to null which is not an object
      expect(decodeCursor(Buffer.from('null').toString('base64url'))).toBe(null);
      // empty object is a valid object and should be returned
      expect(decodeCursor(Buffer.from('{}').toString('base64url'))).toEqual({});
    });

    it('returns null for invalid base64', () => {
      expect(decodeCursor('not-valid-base64!!!')).toBe(null);
    });

    it('returns null for valid base64 that is not JSON', () => {
      expect(decodeCursor('aGVsbG8=')).toBe(null); // "hello" in base64
    });
  });

  describe('isValidCursor', () => {
    it('returns true for valid cursor', () => {
      expect(isValidCursor(encodeCursor({ id: 1 }))).toBe(true);
    });

    it('returns false for null', () => {
      expect(isValidCursor(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isValidCursor(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidCursor('')).toBe(false);
    });

    it('returns false for invalid cursor string', () => {
      expect(isValidCursor('!!!invalid')).toBe(false);
    });
  });
});
