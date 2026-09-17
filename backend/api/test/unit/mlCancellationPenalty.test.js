import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

import { predictCancellationPenalty } from '../../src/services/ml.js';

describe('predictCancellationPenalty', () => {
  beforeEach(() => {
    process.env.ML_API_KEY = 'test-key';
    process.env.ML_ENGINE_URL = 'http://ml.test:8001';
    global.fetch = vi.fn();
  });

  it('posts the distance and amount payload to the ML service', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ penalty_amount: 300, covered_ratio: 0.25 }),
    });

    await expect(predictCancellationPenalty({
      distanceCoveredKm: 25,
      totalDistanceKm: 100,
      totalAmount: 1200,
    })).resolves.toEqual({ penalty_amount: 300, covered_ratio: 0.25 });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://ml.test:8001/cancellation-penalty',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
        body: JSON.stringify({
          distance_covered_km: 25,
          total_distance_km: 100,
          total_amount: 1200,
        }),
      }),
    );
  });

  it.each([
    ['negative covered distance', { distanceCoveredKm: -1, totalDistanceKm: 100, totalAmount: 100 }],
    ['zero total distance', { distanceCoveredKm: 0, totalDistanceKm: 0, totalAmount: 100 }],
    ['negative amount', { distanceCoveredKm: 1, totalDistanceKm: 100, totalAmount: -1 }],
  ])('rejects %s before making a request', async (_label, params) => {
    await expect(predictCancellationPenalty(params)).rejects.toThrow('[ML]');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed ML responses', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ penalty_amount: '300' }),
    });

    await expect(predictCancellationPenalty({
      distanceCoveredKm: 25,
      totalDistanceKm: 100,
      totalAmount: 1200,
    })).rejects.toThrow('Invalid cancellation penalty response');
  });

  it.each([
    ['negative ratio', { penalty_amount: 300, covered_ratio: -0.01 }],
    ['ratio above one', { penalty_amount: 300, covered_ratio: 1.01 }],
    ['negative penalty', { penalty_amount: -1, covered_ratio: 0.25 }],
    ['penalty above total amount', { penalty_amount: 1201, covered_ratio: 0.25 }],
  ])('rejects a response with %s', async (_label, body) => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    });

    await expect(predictCancellationPenalty({
      distanceCoveredKm: 25,
      totalDistanceKm: 100,
      totalAmount: 1200,
    })).rejects.toThrow('Invalid cancellation penalty response');
  });
});
