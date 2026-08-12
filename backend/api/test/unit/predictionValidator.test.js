import { describe, it, expect, vi } from 'vitest';
import { validatePricePrediction, convertToPaisa, RejectionReason } from '../../src/lib/predictionValidator.js';

vi.mock('../../../middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('validatePricePrediction', () => {
  it('returns ok:true for a valid prediction', () => {
    const result = validatePricePrediction({
      estimated_price: 1500,
      currency: 'INR',
    });
    expect(result.ok).toBe(true);
    expect(result.validated.estimated_price).toBe(1500);
    expect(result.validated.currency).toBe('INR');
  });

  it('returns ok:true when all optional fields are present', () => {
    const result = validatePricePrediction({
      estimated_price: 2000,
      currency: 'INR',
      min_price: 1800,
      max_price: 2200,
      confidence: 0.95,
      model_version: 'v2.1',
    });
    expect(result.ok).toBe(true);
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
    expect(validatePricePrediction('string').ok).toBe(false);
    expect(validatePricePrediction(42).ok).toBe(false);
    expect(validatePricePrediction([]).ok).toBe(false);
  });

  it('rejects missing estimated_price', () => {
    const result = validatePricePrediction({ currency: 'INR' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
  });

  it('rejects non-numeric estimated_price', () => {
    const result = validatePricePrediction({
      estimated_price: 'not a number',
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

  it('rejects zero estimated_price', () => {
    const result = validatePricePrediction({
      estimated_price: 0,
      currency: 'INR',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.ZERO);
  });

  it('rejects negative estimated_price', () => {
    const result = validatePricePrediction({
      estimated_price: -100,
      currency: 'INR',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.NEGATIVE);
  });

  it('rejects missing currency', () => {
    const result = validatePricePrediction({ estimated_price: 1500 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
  });

  it('rejects non-INR currency', () => {
    const result = validatePricePrediction({
      estimated_price: 1500,
      currency: 'USD',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_CURRENCY);
  });

  it('rejects min_price that exceeds estimated_price', () => {
    const result = validatePricePrediction({
      estimated_price: 1000,
      currency: 'INR',
      min_price: 1500,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
  });

  it('rejects max_price below estimated_price', () => {
    const result = validatePricePrediction({
      estimated_price: 2000,
      currency: 'INR',
      max_price: 1500,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
  });

  it('rejects non-finite min_price', () => {
    const result = validatePricePrediction({
      estimated_price: 1500,
      currency: 'INR',
      min_price: NaN,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
  });
});

describe('convertToPaisa', () => {
  it('converts INR price to paisa correctly', () => {
    expect(convertToPaisa(100)).toBe(10000);
    expect(convertToPaisa(1.5)).toBe(150);
    expect(convertToPaisa(0)).toBe(0);
  });
});
