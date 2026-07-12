/**
 * Unit tests for backend/api/src/lib/predictionValidator.js
 *
 * Coverage:
 *   - Valid predictions accepted
 *   - Null / undefined rejected
 *   - NaN rejected
 *   - Infinity rejected
 *   - Negative values rejected
 *   - Zero rejected
 *   - Below minimum price rejected
 *   - Above maximum price rejected
 *   - Missing required fields rejected
 *   - Invalid currency rejected
 *   - Invalid min_price / max_price rejected
 *   - Invalid confidence rejected
 *   - convertToPaisa edge cases
 *   - Band ratio limits
 *
 * Run with:  npm run test:unit -- test/unit/predictionValidator.test.js
 */
import { describe, it, expect } from 'vitest';
import {
  validatePricePrediction,
  convertToPaisa,
  RejectionReason,
  __testing,
} from '../../src/lib/predictionValidator.js';

const { MIN_PRICE_INR, MAX_PRICE_INR, MAX_BAND_RATIO } = __testing;

function validResponse(overrides = {}) {
  return {
    estimated_price: 5000,
    min_price: 4250,
    max_price: 5750,
    currency: 'INR',
    confidence: 0.85,
    ...overrides,
  };
}

describe('PredictionValidator', () => {
  // ── Valid predictions ──────────────────────────────────────────────────

  describe('valid predictions', () => {
    it('accepts a fully valid response', () => {
      const result = validatePricePrediction(validResponse());
      expect(result.ok).toBe(true);
      expect(result.validated.estimated_price).toBe(5000);
      expect(result.validated.currency).toBe('INR');
    });

    it('accepts a minimal valid response (only required fields)', () => {
      const result = validatePricePrediction({
        estimated_price: 1000,
        currency: 'INR',
      });
      expect(result.ok).toBe(true);
      expect(result.validated.estimated_price).toBe(1000);
      // min/max default to ±15%
      expect(result.validated.min_price).toBe(850);
      expect(result.validated.max_price).toBe(1150);
      expect(result.validated.confidence).toBeNull();
    });

    it('accepts price at exact minimum boundary', () => {
      const result = validatePricePrediction({
        estimated_price: MIN_PRICE_INR,
        currency: 'INR',
      });
      expect(result.ok).toBe(true);
    });

    it('accepts price at exact maximum boundary', () => {
      const result = validatePricePrediction({
        estimated_price: MAX_PRICE_INR,
        currency: 'INR',
      });
      expect(result.ok).toBe(true);
    });

    it('accepts confidence at exact boundaries (0 and 1)', () => {
      expect(validatePricePrediction({ estimated_price: 1000, currency: 'INR', confidence: 0 }).ok).toBe(true);
      expect(validatePricePrediction({ estimated_price: 1000, currency: 'INR', confidence: 1 }).ok).toBe(true);
    });

    it('rounds prices to 2 decimal places', () => {
      const result = validatePricePrediction({
        estimated_price: 1234.567,
        currency: 'INR',
      });
      expect(result.ok).toBe(true);
      expect(result.validated.estimated_price).toBe(1234.57);
    });
  });

  // ── Null / undefined ───────────────────────────────────────────────────

  describe('null / undefined', () => {
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

  // ── Type errors ────────────────────────────────────────────────────────

  describe('unexpected types', () => {
    it('rejects a string', () => {
      const result = validatePricePrediction('not an object');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.UNEXPECTED_TYPE);
    });

    it('rejects a number', () => {
      const result = validatePricePrediction(42);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.UNEXPECTED_TYPE);
    });

    it('rejects a boolean', () => {
      const result = validatePricePrediction(true);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.UNEXPECTED_TYPE);
    });

    it('rejects an array (passes typeof check but fails on missing fields)', () => {
      const result = validatePricePrediction([]);
      expect(result.ok).toBe(false);
      // typeof [] === 'object' in JS, so it falls through to missing_field
      expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
    });
  });

  // ── Missing fields ─────────────────────────────────────────────────────

  describe('missing required fields', () => {
    it('rejects empty object', () => {
      const result = validatePricePrediction({});
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
      expect(result.detail).toContain('estimated_price');
    });

    it('rejects object missing currency', () => {
      const result = validatePricePrediction({ estimated_price: 5000 });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
      expect(result.detail).toContain('currency');
    });

    it('rejects object missing estimated_price', () => {
      const result = validatePricePrediction({ currency: 'INR' });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
      expect(result.detail).toContain('estimated_price');
    });
  });

  // ── NaN ────────────────────────────────────────────────────────────────

  describe('NaN prediction', () => {
    it('rejects NaN estimated_price', () => {
      const result = validatePricePrediction({
        estimated_price: NaN,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NAN);
    });
  });

  // ── Infinity ───────────────────────────────────────────────────────────

  describe('Infinity prediction', () => {
    it('rejects positive Infinity', () => {
      const result = validatePricePrediction({
        estimated_price: Infinity,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INFINITY);
    });

    it('rejects negative Infinity', () => {
      const result = validatePricePrediction({
        estimated_price: -Infinity,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INFINITY);
    });
  });

  // ── Negative / zero ────────────────────────────────────────────────────

  describe('negative and zero values', () => {
    it('rejects negative price', () => {
      const result = validatePricePrediction({
        estimated_price: -500,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.NEGATIVE);
    });

    it('rejects zero price', () => {
      const result = validatePricePrediction({
        estimated_price: 0,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.ZERO);
    });
  });

  // ── Range limits ───────────────────────────────────────────────────────

  describe('price range limits', () => {
    it('rejects price below minimum', () => {
      const result = validatePricePrediction({
        estimated_price: MIN_PRICE_INR - 1,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.BELOW_MIN);
    });

    it('rejects price above maximum', () => {
      const result = validatePricePrediction({
        estimated_price: MAX_PRICE_INR + 1,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.ABOVE_MAX);
    });

    it('rejects extremely small positive value', () => {
      const result = validatePricePrediction({
        estimated_price: 0.001,
        currency: 'INR',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.BELOW_MIN);
    });
  });

  // ── Currency ───────────────────────────────────────────────────────────

  describe('currency validation', () => {
    it('rejects non-INR currency', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'USD',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CURRENCY);
    });

    it('rejects empty currency', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: '',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CURRENCY);
    });
  });

  // ── min_price / max_price ──────────────────────────────────────────────

  describe('price band validation', () => {
    it('rejects non-numeric min_price', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        min_price: 'cheap',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
    });

    it('rejects NaN min_price', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        min_price: NaN,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
    });

    it('rejects min_price greater than estimated_price', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        min_price: 6000,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
    });

    it('rejects non-numeric max_price', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        max_price: 'expensive',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });

    it('rejects NaN max_price', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        max_price: NaN,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });

    it('rejects max_price less than estimated_price', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        max_price: 4000,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });

    it('rejects max_price exceeding band ratio', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        max_price: 5000 * MAX_BAND_RATIO + 1,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
    });
  });

  // ── Confidence ─────────────────────────────────────────────────────────

  describe('confidence validation', () => {
    it('rejects non-numeric confidence', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        confidence: 'high',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });

    it('rejects NaN confidence', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        confidence: NaN,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });

    it('rejects confidence below 0', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        confidence: -0.1,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });

    it('rejects confidence above 1', () => {
      const result = validatePricePrediction({
        estimated_price: 5000,
        currency: 'INR',
        confidence: 1.5,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
    });
  });
});

describe('convertToPaisa', () => {
  it('converts INR to paisa', () => {
    expect(convertToPaisa(100)).toBe(10000);
  });

  it('rounds to nearest paisa', () => {
    expect(convertToPaisa(10.555)).toBe(1056);
  });

  it('returns null for NaN', () => {
    expect(convertToPaisa(NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(convertToPaisa(Infinity)).toBeNull();
  });

  it('returns null for non-number', () => {
    expect(convertToPaisa('100')).toBeNull();
    expect(convertToPaisa(null)).toBeNull();
    expect(convertToPaisa(undefined)).toBeNull();
  });

  it('handles zero', () => {
    expect(convertToPaisa(0)).toBe(0);
  });

  it('handles negative values', () => {
    expect(convertToPaisa(-5)).toBe(-500);
  });
});

describe('RejectionReason constants', () => {
  it('has all expected reasons', () => {
    expect(RejectionReason.NULL_RESPONSE).toBe('null_response');
    expect(RejectionReason.MISSING_FIELD).toBe('missing_field');
    expect(RejectionReason.NOT_A_NUMBER).toBe('not_a_number');
    expect(RejectionReason.NAN).toBe('nan');
    expect(RejectionReason.INFINITY).toBe('infinity');
    expect(RejectionReason.NEGATIVE).toBe('negative');
    expect(RejectionReason.ZERO).toBe('zero');
    expect(RejectionReason.BELOW_MIN).toBe('below_minimum');
    expect(RejectionReason.ABOVE_MAX).toBe('above_maximum');
    expect(RejectionReason.INVALID_CURRENCY).toBe('invalid_currency');
    expect(RejectionReason.INVALID_MIN_PRICE).toBe('invalid_min_price');
    expect(RejectionReason.INVALID_MAX_PRICE).toBe('invalid_max_price');
    expect(RejectionReason.INVALID_CONFIDENCE).toBe('invalid_confidence');
    expect(RejectionReason.UNEXPECTED_TYPE).toBe('unexpected_type');
  });
});
