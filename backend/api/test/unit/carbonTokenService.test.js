import { describe, it, expect, beforeEach } from 'vitest';
import { carbonTokenService } from '../../src/services/carbonTokenService.js';

describe('carbonTokenService', () => {
  beforeEach(() => {
    carbonTokenService.tokens.clear();
  });

  describe('calculateAndMintCarbonCredits', () => {
    it('throws error when required parameters are missing', async () => {
      await expect(
        carbonTokenService.calculateAndMintCarbonCredits({ tripId: 'trip-1', fuelSavedLiters: 50 })
      ).rejects.toThrow('Missing required parameters');

      await expect(
        carbonTokenService.calculateAndMintCarbonCredits({ truckId: 'truck-1', fuelSavedLiters: 50 })
      ).rejects.toThrow('Missing required parameters');

      await expect(
        carbonTokenService.calculateAndMintCarbonCredits({ truckId: 'truck-1', tripId: 'trip-1' })
      ).rejects.toThrow('Missing required parameters');
    });

    it('accurately calculates saved CO2 metric tons and mints tokens', async () => {
      // 100 liters saved * 2.68 kg/L = 268 kg = 0.268 metric tons
      const record = await carbonTokenService.calculateAndMintCarbonCredits({
        truckId: 'TRUCK-101',
        tripId: 'TRIP-5001',
        distanceKm: 850,
        fuelSavedLiters: 100,
        loadWeightKg: 15000,
      });

      expect(record.tokenId).toMatch(/^CCT-TRIP-5001-\d+$/);
      expect(record.truckId).toBe('TRUCK-101');
      expect(record.tripId).toBe('TRIP-5001');
      expect(record.co2SavedKg).toBe(268);
      expect(record.co2SavedMetricTons).toBe(0.268);
      expect(record.tokenAmount).toBe(0.268);
      expect(record.status).toBe('PENDING_CHAIN_ANCHOR');
      expect(record.chainNetwork).toBeNull();
      expect(record.blockchainTxHash).toBeNull();
      expect(record.mintedAt).toBeDefined();

      const stored = await carbonTokenService.getTokenDetails(record.tokenId);
      expect(stored).toEqual(record);
    });
  });

  describe('purchaseCarbonCredits', () => {
    it('successfully retires minted carbon tokens for Scope 3 emissions offset', async () => {
      const minted = await carbonTokenService.calculateAndMintCarbonCredits({
        truckId: 'TRUCK-202',
        tripId: 'TRIP-7002',
        fuelSavedLiters: 500,
      });

      const buyer = '0x1111111111111111111111111111111111111111';
      const shipper = 'SHIPPER-ACME-INC';

      const retired = await carbonTokenService.purchaseCarbonCredits({
        tokenId: minted.tokenId,
        buyerAddress: buyer,
        shipperId: shipper,
      });

      expect(retired.status).toBe('RETIRED_FOR_OFFSET');
      expect(retired.buyerAddress).toBe(buyer);
      expect(retired.shipperId).toBe(shipper);
      expect(retired.retiredAt).toBeDefined();
      expect(retired.transferTxHash).toBeNull();
    });

    it('rejects double-spending / already retired carbon tokens', async () => {
      const minted = await carbonTokenService.calculateAndMintCarbonCredits({
        truckId: 'TRUCK-303',
        tripId: 'TRIP-8003',
        fuelSavedLiters: 200,
      });

      await carbonTokenService.purchaseCarbonCredits({
        tokenId: minted.tokenId,
        buyerAddress: '0x123',
        shipperId: 'SHIPPER-1',
      });

      await expect(
        carbonTokenService.purchaseCarbonCredits({
          tokenId: minted.tokenId,
          buyerAddress: '0x456',
          shipperId: 'SHIPPER-2',
        })
      ).rejects.toThrow('already been redeemed/retired');
    });

    it('throws error when token is not found', async () => {
      await expect(
        carbonTokenService.purchaseCarbonCredits({
          tokenId: 'CCT-NONEXISTENT-999',
          buyerAddress: '0x123',
          shipperId: 'SHIPPER-1',
        })
      ).rejects.toThrow('Carbon credit token not found');
    });
  });

  describe('getTokenDetails', () => {
    it('returns null for unminted token ID', async () => {
      const details = await carbonTokenService.getTokenDetails('CCT-UNKNOWN');
      expect(details).toBeNull();
    });
  });
});
