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
    it('fails closed as UNSUPPORTED instead of fabricating a BYPASS verdict', async () => {
      // 50 PSI * 250 + 5000 = 17,500 lbs (Well under 34k tandem max and 80k gross)
      const axles = [
        { position: 'steer', pressure_psi: 30 }, // 30 * 250 + 5000 = 12500
        { position: 'drive', pressure_psi: 50 }, // 50 * 250 + 5000 = 17500
        { position: 'trailer', pressure_psi: 50 } // 50 * 250 + 5000 = 17500
      ]; // Gross: 47,500 lbs

      const result = await syncAndTransmitInternalWeights('driver-1', 'truck-1', axles);

      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(result.stationId).toBeNull();
    });

    it('does not fabricate a PULL_IN verdict for an overweight axle', async () => {
      // 120 PSI * 250 + 5000 = 35,000 lbs (Over 34k tandem limit)
      const axles = [
        { position: 'steer', pressure_psi: 30 },
        { position: 'drive', pressure_psi: 120 },
        { position: 'trailer', pressure_psi: 50 }
      ];

      const result = await syncAndTransmitInternalWeights('driver-1', 'truck-1', axles);

      expect(['BYPASS', 'PULL_IN']).not.toContain(result.action);
      expect(result.action).toBe('UNSUPPORTED');
    });

    it('reports that no WIM provider is configured and returns an ISO timestamp', async () => {
      // 110 PSI * 250 + 5000 = 32,500 lbs each * 3 = 97,500 lbs (Over 80k gross limit)
      const axles = [
        { position: 'steer', pressure_psi: 110 },
        { position: 'drive', pressure_psi: 110 },
        { position: 'trailer', pressure_psi: 110 }
      ];

      const result = await syncAndTransmitInternalWeights('driver-1', 'truck-1', axles);

      expect(result.action).toBe('UNSUPPORTED');
      expect(result.reason).toContain('no WIM provider');
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
