import { describe, it, expect } from 'vitest';
import {
  validatePricePrediction,
  convertToPaisa,
  RejectionReason,
} from '../../src/lib/predictionValidator.js';

describe('PredictionValidator Service', () => {
  describe('validatePricePrediction', () => {
    it('validates a correct ML prediction object within bounds', () => {
      const valid = {
        estimated_price: 2500,
        currency: 'INR',
        min_price: 2200,
        max_price: 2800,
        confidence: 0.92,
      };
      const result = validatePricePrediction(valid);
      expect(result.ok).toBe(true);
      expect(result.validated.estimated_price).toBe(2500);
      expect(result.validated.currency).toBe('INR');
      expect(result.validated.confidence).toBe(0.92);
    });

    it('rejects null or undefined inputs with NULL_RESPONSE reason', () => {
      expect(validatePricePrediction(null)).toEqual({
        ok: false,
        reason: RejectionReason.NULL_RESPONSE,
        detail: 'Prediction response is null or undefined',
      });
      expect(validatePricePrediction(undefined)).toEqual({
        ok: false,
        reason: RejectionReason.NULL_RESPONSE,
        detail: 'Prediction response is null or undefined',
      });
    });

    it('rejects non-object types with UNEXPECTED_TYPE reason', () => {
      const res = validatePricePrediction('invalid-string');
      expect(res.ok).toBe(false);
      expect(res.reason).toBe(RejectionReason.UNEXPECTED_TYPE);
    });

    it('rejects missing estimated_price field', () => {
      const res = validatePricePrediction({ currency: 'INR' });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe(RejectionReason.MISSING_FIELD);
    });

    it('rejects predictions below minimum threshold (MIN_PRICE_INR = 100)', () => {
      const res = validatePricePrediction({ estimated_price: 50, currency: 'INR' });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe(RejectionReason.BELOW_MIN);
    });

    it('rejects predictions exceeding maximum threshold (MAX_PRICE_INR = 500,000)', () => {
      const res = validatePricePrediction({ estimated_price: 600000, currency: 'INR' });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe(RejectionReason.ABOVE_MAX);
    });

    it('rejects negative or zero prices', () => {
      expect(validatePricePrediction({ estimated_price: 0, currency: 'INR' }).reason).toBe(RejectionReason.ZERO);
      expect(validatePricePrediction({ estimated_price: -100, currency: 'INR' }).reason).toBe(RejectionReason.NEGATIVE);
    });

    it('rejects invalid currencies (non-INR)', () => {
      const res = validatePricePrediction({ estimated_price: 1500, currency: 'USD' });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe(RejectionReason.INVALID_CURRENCY);
    });

    it('rejects invalid confidence scores out of [0, 1] range', () => {
      const res = validatePricePrediction({ estimated_price: 1500, currency: 'INR', confidence: 1.5 });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });
  });

  describe('convertToPaisa', () => {
    it('converts INR numeric prices to paisa (1 INR = 100 paisa)', () => {
      expect(convertToPaisa(125.5)).toBe(12550);
      expect(convertToPaisa(0)).toBe(0);
    });

    it('returns null for negative values, non-numbers, or non-finite inputs', () => {
      expect(convertToPaisa(-50)).toBeNull();
      expect(convertToPaisa(NaN)).toBeNull();
      expect(convertToPaisa(Infinity)).toBeNull();
      expect(convertToPaisa('100')).toBeNull();
      expect(convertToPaisa(null)).toBeNull();
    });
  });
});
