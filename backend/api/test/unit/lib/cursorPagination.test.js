import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, isValidCursor } from '../../../src/utils/cursorPagination.js';

describe('encodeCursor', () => {
  it('encodes simple object to base64url string', () => {
    const encoded = encodeCursor({ id: '123' });
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
    // base64url uses A-Z, a-z, 0-9, -, _
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('encodes nested object', () => {
    const data = { id: 'abc', nested: { key: 'value' }, arr: [1, 2, 3] };
    const encoded = encodeCursor(data);
    expect(typeof encoded).toBe('string');
  });

  it('encodes empty object', () => {
    const encoded = encodeCursor({});
    expect(typeof encoded).toBe('string');
    // base64url encoding omits padding: {} → JSON → base64 → 'e30=' → 'e30'
    expect(encoded).toBe('e30');
  });

  it('round-trips correctly', () => {
    const original = { id: 'order-123', createdAt: '2026-08-14T10:00:00Z' };
    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(original);
  });
});

describe('decodeCursor', () => {
  it('returns null for null input', () => {
    expect(decodeCursor(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(decodeCursor(123)).toBeNull();
    expect(decodeCursor({})).toBeNull();
    expect(decodeCursor([])).toBeNull();
  });

  it('decodes valid base64url cursor', () => {
    const data = encodeCursor({ page: 2 });
    const decoded = decodeCursor(data);
    expect(decoded).toEqual({ page: 2 });
  });

  it('returns null for invalid base64 string', () => {
    expect(decodeCursor('!!!invalid!!!')).toBeNull();
  });

  it('returns null for valid base64 that is not JSON', () => {
    // base64url of 'not json at all'
    const raw = Buffer.from('not json at all').toString('base64url');
    expect(decodeCursor(raw)).toBeNull();
  });

  it('handles unicode in cursor data', () => {
    const data = encodeCursor({ name: 'John Doe' });
    const decoded = decodeCursor(data);
    expect(decoded.name).toBe('John Doe');
  });

  it('handles special characters', () => {
    const data = encodeCursor({ key: 'a/b+c=d' });
    const decoded = decodeCursor(data);
    expect(decoded.key).toBe('a/b+c=d');
  });
});

describe('isValidCursor', () => {
  it('returns true for valid cursor', () => {
    const valid = encodeCursor({ id: '123' });
    expect(isValidCursor(valid)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidCursor(null)).toBe(false);
  });

  it('returns false for invalid cursor string', () => {
    expect(isValidCursor('!!!invalid!!!')).toBe(false);
  });

  it('returns false for non-string', () => {
    expect(isValidCursor(12345)).toBe(false);
  });
});
