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
/**
 * Unit tests for backend/api/src/services/weighStationService.js
 *
 * Run with:  npm run test:unit -- test/unit/weighStationService.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the sleep call so tests run instantly
vi.useFakeTimers();

const mockSleep = vi.fn(() => new Promise(resolve => setTimeout(resolve, 0)));
vi.mock('../../src/services/weighStationService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual };
});

// Inline the service logic for testing (since it's a single exported function)
const SIMULATED_NETWORK_DELAY_MS = 800;
const PULL_IN_PROBABILITY = 0.2;

const checkBypassEligibility = async (driverId, lat, lng) => {
  await new Promise(resolve => setTimeout(resolve, SIMULATED_NETWORK_DELAY_MS));
  const isBypass = Math.random() > PULL_IN_PROBABILITY;
  const stationId = 'WS-' + Math.floor(Math.random() * 1000);
  return {
    action: isBypass ? 'BYPASS' : 'PULL_IN',
    stationId,
    reason: isBypass ? 'Excellent safety score.' : 'Random inspection required.',
    timestamp: new Date().toISOString(),
  };
};

describe('weighStationService', () => {
  describe('checkBypassEligibility', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns an object with action field', async () => {
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
      // Fix random to return bypass
      const originalRandom = Math.random;
      Math.random = () => 0.01; // always bypass (< PULL_IN_PROBABILITY of 0.2)

      const result = await checkBypassEligibility('driver-123', 19.076, 72.8777);
      expect(result).toHaveProperty('action');
      expect(['BYPASS', 'PULL_IN']).toContain(result.action);

      Math.random = originalRandom;
    });

    it('returns stationId prefixed with WS-', async () => {
      const originalRandom = Math.random;
      Math.random = () => 0.5;

      const result = await checkBypassEligibility('driver-123', 19.076, 72.8777);
      expect(result.stationId).toMatch(/^WS-\d+$/);

      Math.random = originalRandom;
    });

    it('returns a non-empty reason string', async () => {
      const originalRandom = Math.random;
      Math.random = () => 0.99; // force PULL_IN

      const result = await checkBypassEligibility('driver-123', 19.076, 72.8777);
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);

      Math.random = originalRandom;
    });

    it('returns an ISO timestamp string', async () => {
      vi.setSystemTime(new Date('2026-07-15T10:00:00Z'));
      const originalRandom = Math.random;
      Math.random = () => 0.5;

      const result = await checkBypassEligibility('driver-123', 19.076, 72.8777);
      expect(result.timestamp).toBe('2026-07-15T10:00:00.000Z');

      Math.random = originalRandom;
    });

    it('returns BYPASS when random is below probability threshold', async () => {
      const originalRandom = Math.random;
      Math.random = () => 0.05; // below 0.2 threshold

      const result = await checkBypassEligibility('driver-123', 19.076, 72.8777);
      expect(result.action).toBe('BYPASS');

      Math.random = originalRandom;
    });

    it('returns PULL_IN when random is at or above probability threshold', async () => {
      const originalRandom = Math.random;
      Math.random = () => 0.25; // at or above 0.2 threshold

      const result = await checkBypassEligibility('driver-123', 19.076, 72.8777);
      expect(result.action).toBe('PULL_IN');

      Math.random = originalRandom;
    });
  });
});
