import { describe, it, expect } from 'vitest';
import {
  validatePricePrediction,
  convertToPaisa,
  RejectionReason,
} from '../../src/lib/predictionValidator.js';

describe('predictionValidator', () => {
  describe('validatePricePrediction', () => {
    it('accepts a valid price prediction', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
      });
      expect(result.ok).toBe(true);
      expect(result.validated.estimated_price).toBe(5000);
    });

    it('accepts a valid price prediction with min/max prices', () => {
      const result = validatePricePrediction({
        estimated_price: 10000,
        currency: 'INR',
        min_price: 9000,
        max_price: 11000,
        confidence: 0.85,
      });
      expect(result.ok).toBe(true);
      expect(result.validated.min_price).toBe(9000);
      expect(result.validated.max_price).toBe(11000);
      expect(result.validated.confidence).toBe(0.85);
    });

    it('derives min/max prices when not provided', () => {
      const result = validatePricePrediction({
        estimated_price: 10000,
        currency: 'INR',
      });
      expect(result.ok).toBe(true);
      expect(result.validated.min_price).toBe(8500); // 10000 * (1 - 0.15)
      expect(result.validated.max_price).toBe(11500); // 10000 * (1 + 0.15)
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
      const result = validatePricePrediction('string');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.UNEXPECTED_TYPE);
    });

    it('rejects missing estimated_price', () => {
      const result = validatePricePrediction({ currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
    });

    it('rejects non-numeric estimated_price', () => {
      const result = validatePricePrediction({
        estimated_price: '5000',
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NOT_A_NUMBER);
    });

    it('rejects NaN estimated_price', () => {
      const result = validatePricePrediction({
        estimated_price: NaN,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NAN);
    });

    it('rejects Infinity estimated_price', () => {
      const result = validatePricePrediction({
        estimated_price: Infinity,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INFINITY);
    });

    it('rejects negative estimated_price', () => {
      const result = validatePricePrediction({
        estimated_price: -100,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NEGATIVE);
    });

    it('rejects zero estimated_price', () => {
      const result = validatePricePrediction({
        estimated_price: 0,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.ZERO);
    });

    it('rejects price below MIN_PRICE_INR', () => {
      const result = validatePricePrediction({
        estimated_price: 50,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.BELOW_MIN);
    });

    it('rejects price above MAX_PRICE_INR', () => {
      const result = validatePricePrediction({
        estimated_price: 1_000_000,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.ABOVE_MAX);
    });

    it('rejects non-INR currency', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'USD',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CURRENCY);
    });

    it('rejects min_price that exceeds estimated_price', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        min_price: 6000,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
    });

    it('rejects max_price below estimated_price', () => {
      const result = validatePricePrediction({
        estimated_price: 10000,
        currency: 'INR',
        max_price: 5000,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });

    it('rejects max_price exceeding 3x band ratio', () => {
      const result = validatePricePrediction({
        estimated_price: 1000,
        currency: 'INR',
        max_price: 5000,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });

    it('rejects invalid confidence below 0', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        confidence: -0.1,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });

    it('rejects invalid confidence above 1', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        confidence: 1.5,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });

    it('accepts confidence at boundary 0', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        confidence: 0,
      });
      expect(result.ok).toBe(true);
    });

    it('accepts confidence at boundary 1', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        confidence: 1,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('convertToPaisa', () => {
    it('converts INR to paisa correctly', () => {
      expect(convertToPaisa(5000)).toBe(500000);
      expect(convertToPaisa(100.5)).toBe(10050);
      expect(convertToPaisa(0.01)).toBe(1);
    });

    it('returns null for non-finite numbers', () => {
      expect(convertToPaisa(NaN)).toBeNull();
      expect(convertToPaisa(Infinity)).toBeNull();
      expect(convertToPaisa(-Infinity)).toBeNull();
    });

    it('returns null for non-number inputs', () => {
      expect(convertToPaisa('5000')).toBeNull();
      expect(convertToPaisa(null)).toBeNull();
      expect(convertToPaisa(undefined)).toBeNull();
    });
  });
});
