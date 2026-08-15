import { describe, it, expect } from 'vitest';
import {
  validatePricePrediction,
  convertToPaisa,
  RejectionReason,
} from '../../src/lib/predictionValidator.js';

describe('predictionValidator', () => {
  describe('validatePricePrediction', () => {
    const validPrediction = {
      estimated_price: 5000,
      currency: 'INR',
      min_price: 4000,
      max_price: 6000,
      confidence: 0.85,
    };

    it('accepts a valid prediction', () => {
      const result = validatePricePrediction(validPrediction);
      expect(result.ok).toBe(true);
      expect(result.validated.estimated_price).toBe(5000);
      expect(result.validated.currency).toBe('INR');
    });

    it('rejects null input', () => {
      const result = validatePricePrediction(null);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NULL_RESPONSE);
    });

    it('rejects undefined input', () => {
      const result = validatePricePrediction(undefined);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NULL_RESPONSE);
    });

    it('rejects non-object input', () => {
      const result = validatePricePrediction('not an object');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.UNEXPECTED_TYPE);
    });

    it('rejects missing estimated_price', () => {
      const result = validatePricePrediction({ currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
    });

    it('rejects non-number estimated_price', () => {
      const result = validatePricePrediction({ estimated_price: '5000', currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NOT_A_NUMBER);
    });

    it('rejects NaN estimated_price', () => {
      const result = validatePricePrediction({ estimated_price: NaN, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NAN);
    });

    it('rejects Infinity estimated_price', () => {
      const result = validatePricePrediction({ estimated_price: Infinity, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INFINITY);
    });

    it('rejects negative price', () => {
      const result = validatePricePrediction({ estimated_price: -100, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NEGATIVE);
    });

    it('rejects zero price', () => {
      const result = validatePricePrediction({ estimated_price: 0, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.ZERO);
    });

    it('rejects price below minimum (100 INR)', () => {
      const result = validatePricePrediction({ estimated_price: 50, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.BELOW_MIN);
    });

    it('rejects price above maximum (500000 INR)', () => {
      const result = validatePricePrediction({ estimated_price: 600000, currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.ABOVE_MAX);
    });

    it('rejects missing currency', () => {
      const result = validatePricePrediction({ estimated_price: 5000 });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
    });

    it('rejects non-INR currency', () => {
      const result = validatePricePrediction({ estimated_price: 5000, currency: 'USD' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CURRENCY);
    });

    it('rejects invalid min_price type', () => {
      const result = validatePricePrediction({
        ...validPrediction,
        min_price: 'not a number',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
    });

    it('rejects min_price above estimated_price', () => {
      const result = validatePricePrediction({
        ...validPrediction,
        min_price: 6000,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
    });

    it('rejects invalid max_price type', () => {
      const result = validatePricePrediction({
        ...validPrediction,
        max_price: 'not a number',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });

    it('rejects max_price below estimated_price', () => {
      const result = validatePricePrediction({
        ...validPrediction,
        max_price: 4000,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });

    it('rejects confidence outside 0..1 range', () => {
      const result = validatePricePrediction({
        ...validPrediction,
        confidence: 1.5,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });

    it('rejects negative confidence', () => {
      const result = validatePricePrediction({
        ...validPrediction,
        confidence: -0.1,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });

    it('accepts valid confidence at boundaries', () => {
      expect(validatePricePrediction({ ...validPrediction, confidence: 0 }).ok).toBe(true);
      expect(validatePricePrediction({ ...validPrediction, confidence: 1 }).ok).toBe(true);
    });

    it('defaults confidence to null when omitted', () => {
      const { confidence, ...withoutConfidence } = validPrediction;
      const result = validatePricePrediction(withoutConfidence);
      expect(result.ok).toBe(true);
      expect(result.validated.confidence).toBeNull();
    });
  });

  describe('convertToPaisa', () => {
    it('converts INR to paisa correctly', () => {
      expect(convertToPaisa(5000)).toBe(500000);
      expect(convertToPaisa(0.01)).toBe(1);
    });

    it('returns null for invalid inputs', () => {
      expect(convertToPaisa(null)).toBeNull();
      expect(convertToPaisa(NaN)).toBeNull();
      expect(convertToPaisa(Infinity)).toBeNull();
    });
  });
});
