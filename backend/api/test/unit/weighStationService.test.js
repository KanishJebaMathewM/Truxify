import { describe, it, expect } from 'vitest';
import { syncAndTransmitInternalWeights, checkBypassEligibility } from '../../src/services/weighStationService.js';

describe('Weigh Station Service', () => {
  describe('checkBypassEligibility', () => {
    it('returns a BYPASS or PULL_IN action', async () => {
      const result = await checkBypassEligibility('driver-1', 40.0, -75.0);
      expect(['BYPASS', 'PULL_IN']).toContain(result.action);
      expect(result.stationId).toMatch(/^WS-\d+$/);
    });
  });

  describe('syncAndTransmitInternalWeights', () => {
    it('returns BYPASS for completely legal weights', async () => {
      // 50 PSI * 250 + 5000 = 17,500 lbs (Well under 34k tandem max and 80k gross)
      const axles = [
        { position: 'steer', pressure_psi: 30 }, // 30 * 250 + 5000 = 12500
        { position: 'drive', pressure_psi: 50 }, // 50 * 250 + 5000 = 17500
        { position: 'trailer', pressure_psi: 50 } // 50 * 250 + 5000 = 17500
      ]; // Gross: 47,500 lbs

      const result = await syncAndTransmitInternalWeights('driver-1', 'truck-1', axles);
      
      expect(result.action).toBe('BYPASS');
      expect(result.gross_weight_lbs).toBe(47500);
      expect(result.axles.length).toBe(3);
    });

    it('returns PULL_IN if a single axle is overweight', async () => {
      // 120 PSI * 250 + 5000 = 35,000 lbs (Over 34k tandem limit)
      const axles = [
        { position: 'steer', pressure_psi: 30 },
        { position: 'drive', pressure_psi: 120 }, 
        { position: 'trailer', pressure_psi: 50 }
      ];

      const result = await syncAndTransmitInternalWeights('driver-1', 'truck-1', axles);
      
      expect(result.action).toBe('PULL_IN');
      expect(result.reason).toContain('Axle drive overweight');
    });

    it('returns PULL_IN if gross weight is overweight', async () => {
      // 110 PSI * 250 + 5000 = 32,500 lbs each * 3 = 97,500 lbs (Over 80k gross limit)
      const axles = [
        { position: 'steer', pressure_psi: 110 },
        { position: 'drive', pressure_psi: 110 }, 
        { position: 'trailer', pressure_psi: 110 }
      ];

      const result = await syncAndTransmitInternalWeights('driver-1', 'truck-1', axles);
      
      expect(result.action).toBe('PULL_IN');
      expect(result.reason).toContain('Gross weight overweight');
      expect(result.gross_weight_lbs).toBe(97500);
    });
  });
});
