/**
 * Unit tests for backend/api/src/services/weighStationService.js
 *
 * Run with:  npm run test:unit -- test/unit/weighStationService.test.js
 */
import { describe, it, expect } from 'vitest';
import { syncAndTransmitInternalWeights, checkBypassEligibility } from '../../src/services/weighStationService.js';

describe('Weigh Station Service', () => {
  describe('checkBypassEligibility', () => {
    it('fails closed as UNSUPPORTED instead of fabricating a verdict', async () => {
      const result = await checkBypassEligibility('driver-1', 40.0, -75.0);
      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(result.simulated).toBe(true);
      expect(result.stationId).toBeNull();
    });

    it('never returns BYPASS or PULL_IN without a real WIM provider', async () => {
      for (let i = 0; i < 10; i++) {
        const result = await checkBypassEligibility('driver-1', 40.0, -75.0);
        expect(['BYPASS', 'PULL_IN']).not.toContain(result.action);
      }
    });

    it('returns a non-empty reason and an ISO timestamp', async () => {
      const result = await checkBypassEligibility('driver-1', 40.0, -75.0);
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('syncAndTransmitInternalWeights', () => {
    it('returns UNSUPPORTED when no WIM provider is configured', async () => {
      const axles = [
        { position: 'steer', pressure_psi: 30 },
        { position: 'drive', pressure_psi: 50 },
        { position: 'trailer', pressure_psi: 50 }
      ];

      const result = await syncAndTransmitInternalWeights('driver-1', 'truck-1', axles);

      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(result.stationId).toBeNull();
    });

    it('returns UNSUPPORTED for single axle overweight check', async () => {
      const axles = [
        { position: 'steer', pressure_psi: 30 },
        { position: 'drive', pressure_psi: 120 },
        { position: 'trailer', pressure_psi: 50 }
      ];

      const result = await syncAndTransmitInternalWeights('driver-1', 'truck-1', axles);

      expect(result.action).toBe('UNSUPPORTED');
      expect(result.reason).toContain('no WIM provider');
    });

    it('returns UNSUPPORTED for gross weight check', async () => {
      const axles = [
        { position: 'steer', pressure_psi: 110 },
        { position: 'drive', pressure_psi: 110 },
        { position: 'trailer', pressure_psi: 110 }
      ];

      const result = await syncAndTransmitInternalWeights('driver-1', 'truck-1', axles);

      expect(result.action).toBe('UNSUPPORTED');
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
