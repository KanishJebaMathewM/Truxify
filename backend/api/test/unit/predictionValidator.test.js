import { describe, it, expect, vi } from 'vitest';
import {
  validatePricePrediction,
  convertToPaisa,
  RejectionReason,
} from '../../../src/lib/predictionValidator.js';

vi.mock('../../../middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('validatePricePrediction', () => {
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
  });

  it('rejects missing estimated_price field', () => {
    const result = validatePricePrediction({ currency: 'INR' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.MISSING_FIELD);
  });

  it('rejects non-number estimated_price', () => {
    const result = validatePricePrediction({ estimated_price: 'not a number', currency: 'INR' });
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

  it('rejects negative estimated_price', () => {
    const result = validatePricePrediction({ estimated_price: -100, currency: 'INR' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.NEGATIVE);
  });

  it('rejects zero estimated_price', () => {
    const result = validatePricePrediction({ estimated_price: 0, currency: 'INR' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.ZERO);
  });

  it('rejects estimated_price below minimum (100 INR)', () => {
    const result = validatePricePrediction({ estimated_price: 50, currency: 'INR' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.BELOW_MIN);
  });

  it('rejects estimated_price above maximum (500000 INR)', () => {
    const result = validatePricePrediction({ estimated_price: 600000, currency: 'INR' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.ABOVE_MAX);
  });

  it('rejects wrong currency', () => {
    const result = validatePricePrediction({ estimated_price: 50000, currency: 'USD' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_CURRENCY);
  });

  it('accepts valid prediction with all optional fields', () => {
    const result = validatePricePrediction({
      estimated_price: 50000,
      min_price: 40000,
      max_price: 60000,
      currency: 'INR',
      confidence: 0.95,
    });
    expect(result.ok).toBe(true);
    expect(result.validated.estimated_price).toBe(50000);
    expect(result.validated.currency).toBe('INR');
    expect(result.validated.confidence).toBe(0.95);
  });

  it('rejects min_price exceeding estimated_price', () => {
    const result = validatePricePrediction({
      estimated_price: 50000,
      min_price: 60000,
      currency: 'INR',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_MIN_PRICE);
  });

  it('rejects max_price below estimated_price', () => {
    const result = validatePricePrediction({
      estimated_price: 50000,
      max_price: 40000,
      currency: 'INR',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
  });

  it('rejects max_price exceeding 3x band ratio', () => {
    const result = validatePricePrediction({
      estimated_price: 50000,
      max_price: 200000,
      currency: 'INR',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_MAX_PRICE);
  });

  it('rejects confidence outside 0-1 range', () => {
    const result = validatePricePrediction({
      estimated_price: 50000,
      currency: 'INR',
      confidence: 1.5,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
  });

  it('rejects negative confidence', () => {
    const result = validatePricePrediction({
      estimated_price: 50000,
      currency: 'INR',
      confidence: -0.1,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(RejectionReason.INVALID_CONFIDENCE);
  });

  it('applies default confidence when omitted', () => {
    const result = validatePricePrediction({
      estimated_price: 50000,
      currency: 'INR',
    });
    expect(result.ok).toBe(true);
    expect(result.validated.confidence).toBe(null);
  });

  it('computes default price band from estimated_price', () => {
    const result = validatePricePrediction({
      estimated_price: 10000,
      currency: 'INR',
    });
    expect(result.ok).toBe(true);
    // Default band is ±15%
    expect(result.validated.min_price).toBe(8500);
    expect(result.validated.max_price).toBe(11500);
  });
});

describe('convertToPaisa', () => {
  it('converts INR to paisa correctly', () => {
    expect(convertToPaisa(100)).toBe(10000);
    expect(convertToPaisa(1)).toBe(100);
    expect(convertToPaisa(0.5)).toBe(50);
  });

  it('rounds to nearest paisa', () => {
    expect(convertToPaisa(100.005)).toBe(10001);
    expect(convertToPaisa(100.004)).toBe(10000);
  });

  it('returns null for non-number input', () => {
    expect(convertToPaisa('string')).toBe(null);
    expect(convertToPaisa(null)).toBe(null);
    expect(convertToPaisa(undefined)).toBe(null);
  });

  it('returns null for non-finite input', () => {
    expect(convertToPaisa(NaN)).toBe(null);
    expect(convertToPaisa(Infinity)).toBe(null);
    expect(convertToPaisa(-Infinity)).toBe(null);
  });
});
