import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/db.js', () => ({
  supabase: { from: vi.fn() },
}));

vi.mock('../../middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { AnomalyDetectionService } = await import('../../services/security/anomalyDetectionService.js');

describe('AnomalyDetectionService', () => {
  let anomalyService;

  beforeEach(() => {
    vi.clearAllMocks();
    anomalyService = new AnomalyDetectionService({});
  });

  describe('flagTransaction', () => {
    it('returns no flags for normal transaction amounts', async () => {
      const flags = await anomalyService.flagTransaction({
        userId: 'user-1',
        amount: 1000,
        frequency: 1,
        location: { lat: 19, lng: 72 },
      });
      expect(flags.length).toBe(0);
    });

    it('returns flag for very high transaction amount', async () => {
      const flags = await anomalyService.flagTransaction({
        userId: 'user-1',
        amount: 1000000,
        frequency: 1,
        location: { lat: 19, lng: 72 },
      });
      expect(flags.some(f => f.type === 'HIGH_AMOUNT')).toBe(true);
    });

    it('returns flag for very high transaction frequency', async () => {
      const flags = await anomalyService.flagTransaction({
        userId: 'user-1',
        amount: 100,
        frequency: 50,
        location: { lat: 19, lng: 72 },
      });
      expect(flags.some(f => f.type === 'HIGH_FREQUENCY')).toBe(true);
    });

    it('returns multiple flags for extreme transaction pattern', async () => {
      const flags = await anomalyService.flagTransaction({
        userId: 'user-1',
        amount: 1000000,
        frequency: 100,
        location: { lat: 19, lng: 72 },
      });
      expect(flags.length).toBeGreaterThan(1);
    });
  });
});
