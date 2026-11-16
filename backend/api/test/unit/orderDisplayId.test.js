import { describe, it, expect } from 'vitest';
import {
  generateOrderDisplayId,
  isValidOrderDisplayId,
  parseDisplayId,
  batchGenerateOrderDisplayIds,
  extractDateFromDisplayId,
  formatEscrowBookingPayload,
  parseAndValidateEscrowReference,
  validateDisplayIdBatch,
  OrderDisplayIdManager,
  ORDER_DISPLAY_ID_MAX_RETRIES
} from '../../src/lib/orderDisplayId.js';

describe('OrderDisplayId Comprehensive Enterprise Suite (Issue #14101)', () => {

  describe('generateOrderDisplayId', () => {
    it('generates IDs matching the strict format #FF<YYYYMMDD><12-char alphanumeric>', () => {
      const id = generateOrderDisplayId();
      expect(id).toMatch(/^#FF\d{8}[A-Z0-9]{12}$/);
    });

    it('ensures uniqueness across short generation runs (no collisions)', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateOrderDisplayId());
      }
      expect(ids.size).toBe(100);
    });

    it('exports correct max retries constant', () => {
      expect(ORDER_DISPLAY_ID_MAX_RETRIES).toBe(5);
    });
  });

  describe('isValidOrderDisplayId', () => {
    it('returns true for valid generated order display IDs', () => {
      const validId = generateOrderDisplayId();
      expect(isValidOrderDisplayId(validId)).toBe(true);
      expect(isValidOrderDisplayId('#FF20260802K9X2Q7Z4M1A3')).toBe(true);
    });

    it('returns false for wrong prefix, length, or characters', () => {
      expect(isValidOrderDisplayId('FF20260802K9X2Q7Z4M1A3')).toBe(false); // missing #
      expect(isValidOrderDisplayId('#EE20260802K9X2Q7Z4M1A3')).toBe(false); // wrong prefix
      expect(isValidOrderDisplayId('#FF2026802K9X2Q7Z4M1A3')).toBe(false);  // wrong date length
      expect(isValidOrderDisplayId('#FF20260802K9X2Q7Z4M1A')).toBe(false);   // short random suffix
      expect(isValidOrderDisplayId('#FF20260802k9x2q7z4m1a3')).toBe(false); // lowercase letters
    });

    it('returns false for non-string inputs and null/undefined', () => {
      expect(isValidOrderDisplayId(null)).toBe(false);
      expect(isValidOrderDisplayId(undefined)).toBe(false);
      expect(isValidOrderDisplayId(1234567890)).toBe(false);
      expect(isValidOrderDisplayId({})).toBe(false);
    });
  });

  describe('parseDisplayId', () => {
    it('returns valid shape with displayId and null error when valid', () => {
      const id = '#FF20260802K9X2Q7Z4M1A3';
      const result = parseDisplayId(id);
      expect(result).toEqual({ valid: true, displayId: id, error: null });
    });

    it('returns valid: false and error for null, undefined, empty, or non-string input', () => {
      expect(parseDisplayId(null)).toEqual({ valid: false, error: 'Display ID must be a non-empty string' });
      expect(parseDisplayId(undefined)).toEqual({ valid: false, error: 'Display ID must be a non-empty string' });
      expect(parseDisplayId('')).toEqual({ valid: false, error: 'Display ID must be a non-empty string' });
      expect(parseDisplayId(12345)).toEqual({ valid: false, error: 'Display ID must be a non-empty string' });
    });

    it('returns valid: false and format error for malformed display IDs', () => {
      const result = parseDisplayId('#FF20260802INVALID');
      expect(result).toEqual({ valid: false, displayId: null, error: 'Invalid order display ID format' });
    });
  });

  describe('batchGenerateOrderDisplayIds (Enterprise Extension)', () => {
    it('generates requested count of unique IDs', () => {
      const batch = batchGenerateOrderDisplayIds(10);
      expect(batch).toHaveLength(10);
      expect(new Set(batch).size).toBe(10);
      batch.forEach(id => expect(isValidOrderDisplayId(id)).toBe(true));
    });

    it('returns empty array for invalid counts', () => {
      expect(batchGenerateOrderDisplayIds(0)).toEqual([]);
      expect(batchGenerateOrderDisplayIds(-5)).toEqual([]);
      expect(batchGenerateOrderDisplayIds(2000)).toEqual([]); // exceeds upper cap 1000
      expect(batchGenerateOrderDisplayIds('10')).toEqual([]);
    });
  });

  describe('extractDateFromDisplayId (Enterprise Extension)', () => {
    it('correctly extracts Date object from valid display ID', () => {
      const id = '#FF20260802K9X2Q7Z4M1A3';
      const date = extractDateFromDisplayId(id);
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(7); // August is month index 7
      expect(date.getDate()).toBe(2);
    });

    it('returns null for invalid or malformed display IDs', () => {
      expect(extractDateFromDisplayId('invalid-id')).toBeNull();
      expect(extractDateFromDisplayId(null)).toBeNull();
    });
  });

  describe('formatEscrowBookingPayload (Blockchain Extension)', () => {
    it('formats valid display ID into canonical escrow string', () => {
      const id = '#FF20260802K9X2Q7Z4M1A3';
      expect(formatEscrowBookingPayload(id)).toBe('escrow:#FF20260802K9X2Q7Z4M1A3');
    });

    it('returns null for invalid display IDs', () => {
      expect(formatEscrowBookingPayload('bad-id')).toBeNull();
    });
  });

describe('validateDisplayIdBatch (Bulk Validation Extension)', () => {
    it('validates array of IDs and returns accurate summary counts', () => {
      const validId = generateOrderDisplayId();
      const arr = [validId, '#FFINVALID123456', 'bad-id'];
      const summary = validateDisplayIdBatch(arr);
      expect(summary.total).toBe(3);
      expect(summary.validCount).toBe(1);
      expect(summary.invalidCount).toBe(2);
      expect(summary.invalidIds).toContain('bad-id');
    });

    it('handles empty or non-array inputs gracefully', () => {
      expect(validateDisplayIdBatch([])).toEqual({ total: 0, validCount: 0, invalidCount: 0, invalidIds: [] });
      expect(validateDisplayIdBatch(null)).toEqual({ total: 0, validCount: 0, invalidCount: 0, invalidIds: [] });
    });
  });

  describe('OrderDisplayIdManager Unified Export Object', () => {
    it('exposes all utility methods and constants correctly', () => {
      expect(typeof OrderDisplayIdManager.generateOrderDisplayId).toBe('function');
      expect(typeof OrderDisplayIdManager.isValidOrderDisplayId).toBe('function');
      expect(typeof OrderDisplayIdManager.parseDisplayId).toBe('function');
      expect(typeof OrderDisplayIdManager.batchGenerateOrderDisplayIds).toBe('function');
      expect(typeof OrderDisplayIdManager.extractDateFromDisplayId).toBe('function');
      expect(OrderDisplayIdManager.MAX_RETRIES).toBe(5);
    });
  });

  describe('parseAndValidateEscrowReference (Advanced Blockchain Extension)', () => {
    it('correctly parses and validates a valid escrow reference string', () => {
      const id = '#FF20260802K9X2Q7Z4M1A3';
      const ref = `escrow:${id}`;
      const result = parseAndValidateEscrowReference(ref);
      expect(result.valid).toBe(true);
      expect(result.displayId).toBe(id);
      expect(result.orderDate).toBeInstanceOf(Date);
      expect(result.error).toBeNull();
    });

    it('returns valid: false for malformed escrow strings or non-string inputs', () => {
      expect(parseAndValidateEscrowReference('invalid-ref')).toEqual({ valid: false, displayId: null, orderDate: null, error: 'Invalid escrow reference format' });
      expect(parseAndValidateEscrowReference(null)).toEqual({ valid: false, displayId: null, orderDate: null, error: 'Invalid escrow reference format' });
      expect(parseAndValidateEscrowReference('escrow:#FFBADID')).toHaveProperty('valid', false);
    });
  });

  it('parseDisplayId extracts date from valid id', () => {
    const result = parseDisplayId('#FF202608021234567890AB');
    expect(result.valid).toBe(true);
    expect(result.displayId).toBe('#FF202608021234567890AB');
  });

  it('parseDisplayId returns valid: false with error for null and undefined input', () => {
    const resultNull = parseDisplayId(null);
    expect(resultNull.valid).toBe(false);
    expect(resultNull.error).toBe('Display ID must be a non-empty string');

    const resultUndef = parseDisplayId(undefined);
    expect(resultUndef.valid).toBe(false);
    expect(resultUndef.error).toBe('Display ID must be a non-empty string');
  });

  it('parseDisplayId returns valid: false for non-string input', () => {
    const result = parseDisplayId(12345);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Display ID must be a non-empty string');
  });
});


