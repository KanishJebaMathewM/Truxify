import { describe, it, expect } from 'vitest';
import { tireAnalyticsService } from '../../src/services/tireAnalyticsService.js';

describe('tireAnalyticsService', () => {
  describe('analyzeTireHealth', () => {
    it('throws an error if tpmsReadings is empty or not an array', async () => {
      await expect(
        tireAnalyticsService.analyzeTireHealth({ truckId: 'truck-1', tpmsReadings: [] })
      ).rejects.toThrow('Invalid or empty TPMS readings provided');

      await expect(
        tireAnalyticsService.analyzeTireHealth({ truckId: 'truck-1', tpmsReadings: null })
      ).rejects.toThrow('Invalid or empty TPMS readings provided');
    });

    it('classifies tire condition as NORMAL and status as OPERATIONAL when metrics are within thresholds', async () => {
      const report = await tireAnalyticsService.analyzeTireHealth({
        truckId: 'truck-normal',
        tpmsReadings: [
          { position: 'FL', pressurePsi: 105, tempC: 45, mileageKm: 20000 },
          { position: 'FR', pressurePsi: 104, tempC: 44, mileageKm: 20000 },
        ],
      });

      expect(report.overallHealth).toBe('OPERATIONAL');
      expect(report.tires).toHaveLength(2);
      expect(report.tires[0].alertLevel).toBe('NORMAL');
      expect(report.tires[0].recommendation).toBe('Tire condition optimal');
      expect(report.tires[0].remainingLifeKm).toBeGreaterThan(0);
    });

    it('classifies tire condition as WARNING when wear exceeds warning threshold without critical metrics', async () => {
      const report = await tireAnalyticsService.analyzeTireHealth({
        truckId: 'truck-warn',
        tpmsReadings: [
          { position: 'RL', pressurePsi: 105, tempC: 50, mileageKm: 86000 },
        ],
      });

      expect(report.overallHealth).toBe('OPERATIONAL');
      expect(report.tires[0].alertLevel).toBe('WARNING');
      expect(report.tires[0].recommendation).toBe('Schedule tire inspection/rotation soon');
      expect(report.tires[0].wearPercent).toBeGreaterThan(70);
      expect(report.tires[0].wearPercent).toBeLessThanOrEqual(85);
    });

    it('classifies tire condition as CRITICAL and triggers CRITICAL_ATTENTION_REQUIRED', async () => {
      const report = await tireAnalyticsService.analyzeTireHealth({
        truckId: 'truck-crit',
        tpmsReadings: [
          { position: 'FL', pressurePsi: 75, tempC: 85, mileageKm: 110000 },
          { position: 'FR', pressurePsi: 105, tempC: 45, mileageKm: 20000 },
        ],
      });

      expect(report.overallHealth).toBe('CRITICAL_ATTENTION_REQUIRED');
      const critTire = report.tires.find((t) => t.position === 'FL');
      expect(critTire.alertLevel).toBe('CRITICAL');
      expect(critTire.recommendation).toBe('Immediate tire replacement required');
    });
  });

  describe('getTireStatus', () => {
    it('retrieves previously analyzed tire report for a truck', async () => {
      await tireAnalyticsService.analyzeTireHealth({
        truckId: 'truck-cached',
        tpmsReadings: [{ position: 'FL', pressurePsi: 105, tempC: 40, mileageKm: 15000 }],
      });

      const cached = await tireAnalyticsService.getTireStatus('truck-cached');
      expect(cached).toBeDefined();
      expect(cached.truckId).toBe('truck-cached');
    });

    it('returns null for an un-analyzed truck ID', async () => {
      const missing = await tireAnalyticsService.getTireStatus('unknown-truck-id');
      expect(missing).toBeNull();
    });

    it('does not return a report to a different owner', async () => {
      await tireAnalyticsService.analyzeTireHealth({
        ownerId: 'owner-a',
        truckId: 'truck-owned',
        tpmsReadings: [{ position: 'FL', pressurePsi: 105, tempC: 40, mileageKm: 15000 }],
      });

      await expect(tireAnalyticsService.getTireStatus('truck-owned', 'owner-b')).resolves.toBeNull();
      await expect(tireAnalyticsService.getTireStatus('truck-owned', 'owner-a')).resolves.toMatchObject({
        truckId: 'truck-owned',
        ownerId: 'owner-a',
      });
    });
  });
});
