import { describe, it, expect } from 'vitest';
import carbonOffsetService from '../../src/services/carbonOffsetService.js';

describe('carbonOffsetService', () => {
  describe('calculateFootprint', () => {
    it('calculates carbon footprint correctly for standard distance and weight', () => {
      // 500 km * 2000 kg * 0.00015 = 150 kg CO2 = 0.15 tons
      const footprint = carbonOffsetService.calculateFootprint(500, 2000);
      expect(footprint).toBe(0.15);
    });

    it('returns 0 tons when distance or weight is zero', () => {
      expect(carbonOffsetService.calculateFootprint(0, 5000)).toBe(0);
      expect(carbonOffsetService.calculateFootprint(500, 0)).toBe(0);
    });

    it('accurately rounds footprint to 4 decimal places for small shipments', () => {
      // 10 km * 50 kg * 0.00015 = 0.075 kg CO2 = 0.000075 -> 0.0001
      const footprint = carbonOffsetService.calculateFootprint(10, 50);
      expect(footprint).toBe(0.0001);
    });
  });

  describe('getOffsetPackages', () => {
    it('returns the predefined offset packages catalog', () => {
      const packages = carbonOffsetService.getOffsetPackages();
      expect(Array.isArray(packages)).toBe(true);
      expect(packages.length).toBe(3);

      const packageIds = packages.map((p) => p.id);
      expect(packageIds).toEqual(['basic', 'standard', 'premium']);

      packages.forEach((pkg) => {
        expect(pkg).toHaveProperty('id');
        expect(pkg).toHaveProperty('tons');
        expect(pkg).toHaveProperty('price');
        expect(pkg).toHaveProperty('description');
        expect(pkg.tons).toBeGreaterThan(0);
        expect(pkg.price).toBeGreaterThan(0);
      });
    });
  });

  describe('purchaseOffset', () => {
    it('successfully creates an offset certificate for a valid package', async () => {
      const userId = 'user-abc-123';
      const packageId = 'standard';
      const shipmentId = 'ship-xyz-789';

      const result = await carbonOffsetService.purchaseOffset(userId, packageId, shipmentId);

      expect(result.success).toBe(true);
      expect(result.userId).toBe(userId);
      expect(result.shipmentId).toBe(shipmentId);
      expect(result.package.id).toBe('standard');
      expect(result.package.tons).toBe(5);
      expect(result.certificateId).toMatch(/^CERT-\d+-[A-Z0-9]+$/);
      expect(result.issuedAt).toBeDefined();
      expect(result.message).toBe('Carbon offset purchased successfully.');
    });

    it('throws error when invalid packageId is supplied', async () => {
      await expect(
        carbonOffsetService.purchaseOffset('user-1', 'non-existent-pkg', 'ship-1')
      ).rejects.toThrow('Invalid offset package selected.');
    });
  });
});
