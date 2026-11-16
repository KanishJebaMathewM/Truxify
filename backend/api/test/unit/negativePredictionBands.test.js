import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
import { validatePricePrediction, RejectionReason } from '../../src/lib/predictionValidator.js';

const base = { estimated_price: 1000, currency: 'INR', max_price: 1500 };
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('ML_API_KEY', 'unit-test-only-key');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const response = body => new Response(JSON.stringify(body), { status: 200 });

describe('nonnegative optional ML lower price bands', () => {
  it.each([-200, -0.01, -0.001, -Number.MIN_VALUE])('rejects negative min_price %j before rounding', minPrice => {
    const result = validatePricePrediction({ ...base, min_price: minPrice });
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: RejectionReason.INVALID_MIN_PRICE }));
    expect(result).not.toHaveProperty('validated');
  });
  it.each([0, 0.01, 850.123, 1000])('preserves supported lower band %j', minPrice => {
    const result = validatePricePrediction({ ...base, min_price: minPrice });
    expect(result.ok).toBe(true);
    expect(result.validated.min_price).toBe(Math.round(minPrice * 100) / 100);
  });
  it('retains omitted lower-band defaults', () => {
    expect(validatePricePrediction(base).validated.min_price).toBe(850);
  });
  it('retains the existing rejection of lower bands above the central prediction', () => {
    expect(validatePricePrediction({ ...base, min_price: 1001 }).reason).toBe(RejectionReason.INVALID_MIN_PRICE);
  });
  it.each([-200, -0.001])('actual predictPrice rejects band %j without poisoning the real cache', async minPrice => {
    fetch.mockResolvedValueOnce(response({ ...base, min_price: minPrice }))
      .mockResolvedValueOnce(response({ ...base, min_price: 850 }));
    const { predictPrice } = await import('../../src/services/ml.js');
    const params = { distanceKm: 100, cargoWeightKg: 1000, truckType: 'medium_truck', trafficMultiplier: 2 };
    await expect(predictPrice(params)).rejects.toThrow('[ML] Invalid prediction: invalid_min_price');
    const valid = await predictPrice(params);
    expect(valid.min_price).toBe(1700);
    expect(valid.estimated_price).toBe(2000);
    expect(valid.estimatedPricePaisa).toBe(200000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(predictPrice(params)).resolves.toEqual(valid);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
