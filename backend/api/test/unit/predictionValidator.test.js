import { describe, it, expect } from 'vitest';
import { validatePricePrediction, RejectionReason } from '../../src/lib/predictionValidator.js';

describe('validatePricePrediction', () => {
  it('accepts a valid prediction', () => {
    const prediction = {
      predictedPrice: 5000,
      currency: 'INR',
      minPrice: 1000,
      maxPrice: 10000,
      confidence: 0.95,
    };
    expect(validatePricePrediction(prediction)).toEqual({ valid: true });
  });

  it('rejects null response', () => {
    const result = validatePricePrediction(null);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(RejectionReason.NULL_RESPONSE);
  });

  it('rejects missing predictedPrice', () => {
    const result = validatePricePrediction({ currency: 'INR' });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
  });

  it('rejects NaN predictedPrice', () => {
    const result = validatePricePrediction({ predictedPrice: NaN, currency: 'INR' });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(RejectionReason.NAN);
  });

  it('rejects negative price', () => {
    const result = validatePricePrediction({ predictedPrice: -100, currency: 'INR' });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(RejectionReason.NEGATIVE);
  });

  it('rejects zero price when configured', () => {
    const result = validatePricePrediction({
      predictedPrice: 0,
      currency: 'INR',
      allowZero: false,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(RejectionReason.ZERO);
  });

  it('rejects confidence > 1', () => {
    const result = validatePricePrediction({
      predictedPrice: 5000,
      currency: 'INR',
      confidence: 1.5,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
  });

  it('rejects invalid currency', () => {
    const result = validatePricePrediction({
      predictedPrice: 5000,
      currency: 'USD',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_CURRENCY);
  });
});

describe('RejectionReason', () => {
  it('has all expected reason constants', () => {
    expect(RejectionReason.NULL_RESPONSE).toBe('null_response');
    expect(RejectionReason.MISSING_FIELD).toBe('missing_field');
    expect(RejectionReason.NOT_A_NUMBER).toBe('not_a_number');
    expect(RejectionReason.NEGATIVE).toBe('negative');
    expect(RejectionReason.ZERO).toBe('zero');
    expect(RejectionReason.INVALID_CONFIDENCE).toBe('invalid_confidence');
  });
});
