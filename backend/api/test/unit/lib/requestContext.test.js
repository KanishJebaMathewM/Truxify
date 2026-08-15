import { describe, it, expect } from 'vitest';
import { safeJsonParseWithFallback } from '../../../src/lib/requestContext.js';

describe('safeJsonParseWithFallback', () => {
  it('returns fallback for null', () => {
    expect(safeJsonParseWithFallback(null, { default: true })).toEqual({ default: true });
  });

  it('returns fallback for undefined', () => {
    expect(safeJsonParseWithFallback(undefined, [])).toEqual([]);
  });

  it('parses valid JSON objects', () => {
    expect(safeJsonParseWithFallback('{"key":"value"}', null)).toEqual({ key: 'value' });
    expect(safeJsonParseWithFallback('{"a":1,"b":2}', null)).toEqual({ a: 1, b: 2 });
  });

  it('parses nested JSON objects', () => {
    const input = '{"user":{"name":"Alice","age":30},"active":true}';
    expect(safeJsonParseWithFallback(input, null)).toEqual({
      user: { name: 'Alice', age: 30 },
      active: true,
    });
  });

  it('returns fallback for invalid JSON string', () => {
    expect(safeJsonParseWithFallback('not json', { fallback: true })).toEqual({ fallback: true });
    expect(safeJsonParseWithFallback('{broken', { fallback: true })).toEqual({ fallback: true });
    expect(safeJsonParseWithFallback('', { fallback: true })).toEqual({ fallback: true });
  });

  it('returns fallback for JSON arrays (only objects allowed)', () => {
    expect(safeJsonParseWithFallback('[1, 2, 3]', null)).toBeNull();
    expect(safeJsonParseWithFallback('[]', null)).toBeNull();
  });

  it('returns fallback for JSON primitives', () => {
    expect(safeJsonParseWithFallback('"just a string"', null)).toBeNull();
    expect(safeJsonParseWithFallback('123', null)).toBeNull();
    expect(safeJsonParseWithFallback('true', null)).toBeNull();
    expect(safeJsonParseWithFallback('null', null)).toBeNull();
  });

  it('handles whitespace-only strings', () => {
    expect(safeJsonParseWithFallback('   ', null)).toBeNull();
    expect(safeJsonParseWithFallback('\n\t', null)).toBeNull();
  });

  it('returns undefined when no fallback provided and input is null', () => {
    // raw == null returns fallback (undefined) when no fallback provided
    expect(safeJsonParseWithFallback(null)).toBeUndefined();
  });

  it('returns undefined when no fallback provided and input is invalid JSON', () => {
    expect(safeJsonParseWithFallback('not-json')).toBeUndefined();
    expect(safeJsonParseWithFallback('[1,2]')).toBeUndefined();
  });
});
