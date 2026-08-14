/**
 * Unit tests for safeJsonParseWithFallback utility
 *
 * Run with: npm run test:unit -- test/unit/safeJsonParseWithFallback.test.js
 */
import { describe, it, expect } from 'vitest';
import { safeJsonParseWithFallback } from '../../src/lib/requestContext.js';

describe('safeJsonParseWithFallback', () => {
  const fallback = { default: true };

  it('returns parsed object for valid JSON object', () => {
    const input = '{"key":"value","num":42}';
    const result = safeJsonParseWithFallback(input, fallback);
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('returns fallback for null input', () => {
    expect(safeJsonParseWithFallback(null, fallback)).toBe(fallback);
  });

  it('returns fallback for undefined input', () => {
    expect(safeJsonParseWithFallback(undefined, fallback)).toBe(fallback);
  });

  it('returns fallback for invalid JSON string', () => {
    expect(safeJsonParseWithFallback('not valid json', fallback)).toBe(fallback);
  });

  it('returns fallback for malformed JSON (missing closing brace)', () => {
    expect(safeJsonParseWithFallback('{"key":"value"', fallback)).toBe(fallback);
  });

  it('returns fallback for JSON array', () => {
    expect(safeJsonParseWithFallback('[1,2,3]', fallback)).toBe(fallback);
  });

  it('returns fallback for JSON primitive (string)', () => {
    expect(safeJsonParseWithFallback('"just a string"', fallback)).toBe(fallback);
  });

  it('returns fallback for JSON primitive (number)', () => {
    expect(safeJsonParseWithFallback('42', fallback)).toBe(fallback);
  });

  it('returns fallback for JSON primitive (boolean)', () => {
    expect(safeJsonParseWithFallback('true', fallback)).toBe(fallback);
  });

  it('returns fallback for empty string', () => {
    expect(safeJsonParseWithFallback('', fallback)).toBe(fallback);
  });

  it('returns parsed object for nested JSON object', () => {
    const input = '{"outer":{"inner":"value"},"arr":[1,2]}';
    const result = safeJsonParseWithFallback(input, fallback);
    expect(result).toEqual({ outer: { inner: 'value' }, arr: [1, 2] });
  });

  it('uses custom fallback when provided', () => {
    const customFallback = { custom: 'fallback' };
    expect(safeJsonParseWithFallback('invalid', customFallback)).toBe(customFallback);
  });

  it('returns parsed object for empty object', () => {
    expect(safeJsonParseWithFallback('{}', fallback)).toEqual({});
  });

  it('returns parsed object for object with null value', () => {
    const result = safeJsonParseWithFallback('{"key":null}', fallback);
    expect(result).toEqual({ key: null });
  });
});
