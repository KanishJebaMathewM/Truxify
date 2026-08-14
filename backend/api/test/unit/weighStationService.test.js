import { describe, it, expect, vi } from 'vitest';
import {
  checkBypassEligibility,
  syncAndTransmitInternalWeights,
} from '../../src/services/weighStationService.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('weighStationService', () => {
  describe('checkBypassEligibility', () => {
    it('returns UNSUPPORTED when called without real WIM provider', async () => {
      const result = await checkBypassEligibility('driver-1', 38.9, -77.0);
      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(result.simulated).toBe(true);
      expect(result.reason).toContain('no WIM provider is configured');
      expect(result).toHaveProperty('timestamp');
    });

    it('includes stationId as null when unsupported', async () => {
      const result = await checkBypassEligibility('driver-2', 40.7, -74.0);
      expect(result.stationId).toBeNull();
    });

    it('returns a timestamp in ISO format', async () => {
      const result = await checkBypassEligibility('driver-3', 34.0, -118.2);
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('syncAndTransmitInternalWeights', () => {
    it('returns UNSUPPORTED when no WIM provider is configured', async () => {
      const result = await syncAndTransmitInternalWeights('driver-1', 'truck-1', [
        { axle_number: 1, weight_kg: 5000 },
        { axle_number: 2, weight_kg: 7000 },
      ]);
      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(result.stationId).toBeNull();
      expect(result.reason).toContain('no WIM provider');
    });
  });
});
