import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeJsonParseWithFallback } from '../../src/lib/requestContext.js';

describe('safeJsonParseWithFallback', () => {
  it('parses valid JSON objects', () => {
    expect(safeJsonParseWithFallback('{"key":"value"}', {})).toEqual({ key: 'value' });
    expect(safeJsonParseWithFallback('{"a":1,"b":2}', {})).toEqual({ a: 1, b: 2 });
  });

  it('returns fallback for null', () => {
    expect(safeJsonParseWithFallback(null, { default: true })).toEqual({ default: true });
    expect(safeJsonParseWithFallback(undefined, { fallback: 'x' })).toEqual({ fallback: 'x' });
  });

  it('returns fallback for invalid JSON', () => {
    expect(safeJsonParseWithFallback('not json', { ok: false })).toEqual({ ok: false });
    expect(safeJsonParseWithFallback('{ broken }', {})).toEqual({});
  });

  it('returns fallback for JSON arrays (only objects allowed)', () => {
    expect(safeJsonParseWithFallback('[1,2,3]', [])).toEqual([]);
    expect(safeJsonParseWithFallback('["a","b"]', null)).toBeNull();
  });

  it('returns fallback for JSON primitives', () => {
    expect(safeJsonParseWithFallback('"just a string"', null)).toBeNull();
    expect(safeJsonParseWithFallback('123', null)).toBeNull();
    expect(safeJsonParseWithFallback('true', null)).toBeNull();
  });

  it('handles empty string as non-null input', () => {
    // Empty string is not null, so it attempts to parse and returns fallback
    expect(safeJsonParseWithFallback('', {})).toEqual({});
  });

  it('uses custom fallback', () => {
    const custom = { custom: true };
    expect(safeJsonParseWithFallback('not valid', custom)).toBe(custom);
  });
});
