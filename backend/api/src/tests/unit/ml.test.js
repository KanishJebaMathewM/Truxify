import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.ML_API_KEY = 'test-key';
process.env.ML_ENGINE_URL = 'http://ml-engine.test';

import { predictPrice } from '../../services/ml.js';

describe('ml.js predictPrice', () => {
  afterEach(() => {
    delete process.env.ML_API_KEY;
    delete process.env.ML_ENGINE_URL;
    delete globalThis.fetch;
  });

  it('returns a validated prediction enriched with paisa and INR amounts', async () => {
    process.env.ML_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          estimated_price: 1000,
          min_price: 800,
          max_price: 1200,
          currency: 'INR',
        }),
    });

    const result = await predictPrice({ distanceKm: 120, cargoWeightKg: 5000 });

    expect(result.estimated_price).toBe(1000);
    expect(result.min_price).toBe(800);
    expect(result.max_price).toBe(1200);
    expect(result.currency).toBe('INR');
    expect(result.estimatedPriceInr).toBe(1000);
    expect(result.estimatedPricePaisa).toBe(100000);
  });

  it('throws when the ML engine returns an out-of-range prediction', async () => {
    process.env.ML_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ estimated_price: -5, currency: 'INR' }),
    });

    await expect(
      predictPrice({ distanceKm: 250, cargoWeightKg: 8000 }),
    ).rejects.toThrow(/Invalid prediction/);
  });
});
