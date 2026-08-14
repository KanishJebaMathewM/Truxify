import { describe, it, expect } from 'vitest';
import {
  validatePricePrediction,
  convertToPaisa,
  RejectionReason,
} from '../../../src/lib/predictionValidator.js';

describe('validatePricePrediction', () => {
  describe('null/undefined input', () => {
    it('rejects null', () => {
      const result = validatePricePrediction(null);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NULL_RESPONSE);
    });

    it('rejects undefined', () => {
      const result = validatePricePrediction(undefined);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NULL_RESPONSE);
    });
  });

  describe('type check', () => {
    it('rejects non-object inputs', () => {
      expect(validatePricePrediction('string').reason).toBe(RejectionReason.UNEXPECTED_TYPE);
      expect(validatePricePrediction(123).reason).toBe(RejectionReason.UNEXPECTED_TYPE);
      // Arrays are typeof 'object' so they reach the 'estimated_price' check
      expect(validatePricePrediction([]).reason).toBe(RejectionReason.MISSING_FIELD);
    });
  });

  describe('estimated_price validation', () => {
    it('rejects missing estimated_price', () => {
      const result = validatePricePrediction({ currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
    });

    it('rejects non-number estimated_price', () => {
      const result = validatePricePrediction({ estimated_price: '1000', currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NOT_A_NUMBER);
    });

    it('rejects NaN estimated_price', () => {
      const result = validatePricePrediction({ estimated_price: NaN, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NAN);
    });

    it('rejects Infinity estimated_price', () => {
      expect(validatePricePrediction({ estimated_price: Infinity, currency: 'INR' }).reason).toBe(RejectionReason.INFINITY);
      expect(validatePricePrediction({ estimated_price: -Infinity, currency: 'INR' }).reason).toBe(RejectionReason.INFINITY);
    });

    it('rejects zero estimated_price', () => {
      const result = validatePricePrediction({ estimated_price: 0, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.ZERO);
    });

    it('rejects negative estimated_price', () => {
      const result = validatePricePrediction({ estimated_price: -500, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NEGATIVE);
    });

    it('rejects estimated_price below MIN (100 INR)', () => {
      const result = validatePricePrediction({ estimated_price: 99, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.BELOW_MIN);
    });

    it('rejects estimated_price above MAX (500,000 INR)', () => {
      const result = validatePricePrediction({ estimated_price: 500001, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.ABOVE_MAX);
    });
  });

  describe('currency validation', () => {
    it('rejects missing currency', () => {
      const result = validatePricePrediction({ estimated_price: 1000 });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
    });

    it('rejects non-INR currency', () => {
      const result = validatePricePrediction({ estimated_price: 1000, currency: 'USD' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CURRENCY);
    });
  });

  describe('min_price validation', () => {
    it('rejects non-finite min_price', () => {
      const result = validatePricePrediction({ estimated_price: 50000, currency: 'INR', min_price: NaN });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
    });

    it('rejects min_price above estimated_price', () => {
      const result = validatePricePrediction({ estimated_price: 50000, currency: 'INR', min_price: 60000 });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
    });
  });

  describe('max_price validation', () => {
    it('rejects non-finite max_price', () => {
      const result = validatePricePrediction({ estimated_price: 50000, currency: 'INR', max_price: Infinity });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });

    it('rejects max_price below estimated_price', () => {
      const result = validatePricePrediction({ estimated_price: 50000, currency: 'INR', max_price: 30000 });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });

    it('rejects max_price exceeding 3x estimated_price', () => {
      const result = validatePricePrediction({ estimated_price: 10000, currency: 'INR', max_price: 30001 });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });
  });

  describe('confidence validation', () => {
    it('rejects non-finite confidence', () => {
      const result = validatePricePrediction({ estimated_price: 50000, currency: 'INR', confidence: NaN });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });

    it('rejects confidence below 0', () => {
      const result = validatePricePrediction({ estimated_price: 50000, currency: 'INR', confidence: -0.1 });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });

    it('rejects confidence above 1', () => {
      const result = validatePricePrediction({ estimated_price: 50000, currency: 'INR', confidence: 1.5 });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });
  });

  describe('valid predictions', () => {
    it('returns ok for valid minimal prediction', () => {
      const result = validatePricePrediction({ estimated_price: 1000, currency: 'INR' });
      expect(result.ok).toBe(true);
      expect(result.validated.estimated_price).toBe(1000);
      expect(result.validated.currency).toBe('INR');
      expect(result.validated.confidence).toBeNull();
    });

    it('returns ok with all optional fields', () => {
      const result = validatePricePrediction({
        estimated_price: 50000,
        currency: 'INR',
        min_price: 40000,
        max_price: 60000,
        confidence: 0.95,
      });
      expect(result.ok).toBe(true);
      expect(result.validated.estimated_price).toBe(50000);
      expect(result.validated.min_price).toBe(40000);
      expect(result.validated.max_price).toBe(60000);
      expect(result.validated.confidence).toBe(0.95);
    });

    it('derives default min/max when not provided', () => {
      const result = validatePricePrediction({ estimated_price: 10000, currency: 'INR' });
      expect(result.ok).toBe(true);
      expect(result.validated.min_price).toBe(8500);  // 10000 * 0.85
      expect(result.validated.max_price).toBe(11500); // 10000 * 1.15
    });

    it('accepts boundary values (100 and 500000 INR)', () => {
      expect(validatePricePrediction({ estimated_price: 100, currency: 'INR' }).ok).toBe(true);
      expect(validatePricePrediction({ estimated_price: 500000, currency: 'INR' }).ok).toBe(true);
    });
  });
});

describe('convertToPaisa', () => {
  it('converts INR to paisa correctly', () => {
    expect(convertToPaisa(100)).toBe(10000);
    expect(convertToPaisa(1)).toBe(100);
    expect(convertToPaisa(0.01)).toBe(1);
    expect(convertToPaisa(1000.50)).toBe(100050);
  });

  it('rounds to nearest paisa', () => {
    // IEEE 754 floating point: 1.005 * 100 ≈ 100.4999... → rounds to 100
    expect(convertToPaisa(1.005)).toBe(100);
    // 1.0051 * 100 ≈ 100.51 → rounds up to 101
    expect(convertToPaisa(1.0051)).toBe(101);
  });

  it('returns null for non-finite inputs', () => {
    expect(convertToPaisa(NaN)).toBeNull();
    expect(convertToPaisa(Infinity)).toBeNull();
    expect(convertToPaisa(-Infinity)).toBeNull();
    expect(convertToPaisa(null)).toBeNull();
    expect(convertToPaisa(undefined)).toBeNull();
    expect(convertToPaisa('string')).toBeNull();
  });

  it('handles edge case of 0', () => {
    expect(convertToPaisa(0)).toBe(0);
  });
});
