import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.ML_API_KEY = 'test-key';
process.env.ML_ENGINE_URL = 'http://ml-engine.test';

import { predictDemand } from '../../src/services/ml.js';

describe('ml.js predictDemand', () => {
  afterEach(() => {
    delete process.env.ML_API_KEY;
    delete process.env.ML_ENGINE_URL;
    delete globalThis.fetch;
  });

  it('throws when ML_API_KEY is not configured', async () => {
    delete process.env.ML_API_KEY;
    await expect(predictDemand({ lat: 28, lng: 77 })).rejects.toThrow(/ML_API_KEY/);
  });

  it('returns a prediction for valid location and time', async () => {
    process.env.ML_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ demand: 42, currency: 'loads' }),
    });

    const result = await predictDemand({ lat: 28.6139, lng: 77.2090 }, Date.now());
    expect(result).toHaveProperty('demand');
    expect(typeof result.demand).toBe('number');
    expect(result.demand).toBe(42);
  });

  it('throws when the ML endpoint returns an error', async () => {
    process.env.ML_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'model unavailable',
    });

    await expect(predictDemand({ lat: 28, lng: 77 })).rejects.toThrow(/503/);
  });
});