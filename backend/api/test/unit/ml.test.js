import { describe, it, expect } from 'vitest';
import { predictDemand } from '../../../src/services/ml.js';

describe('ml.js', () => {
  it('returns a prediction for valid location and time', async () => {
    const result = await predictDemand({ lat: 28.6139, lng: 77.2090 }, Date.now());
    expect(result).toHaveProperty('demand');
    expect(typeof result.demand).toBe('number');
  });

  it('throws for invalid coordinates', async () => {
    await expect(predictDemand({ lat: 999, lng: 999 }, Date.now())).rejects.toThrow();
  });
});
