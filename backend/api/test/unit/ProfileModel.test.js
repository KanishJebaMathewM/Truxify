import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileModel } from '../../../src/models/ProfileModel.js';

describe('ProfileModel', () => {
  describe('fromProfile', () => {
    it('normalizes a profile object correctly', () => {
      const raw = {
        id: 'uuid-1',
        firebase_uid: 'firebase-123',
        role: 'driver',
        full_name: 'John Doe',
        phone: '1234567890',
        email: 'john@example.com',
        company_name: 'Truxify Inc',
        avatar_url: 'https://example.com/avatar.jpg',
        language: 'en',
        dark_mode: true,
        is_active: true,
        wallet_address: '0x1234',
        polygon_wallet_address: '0x5678',
      };

      const result = ProfileModel.fromProfile(raw);

      expect(result.id).toBe('uuid-1');
      expect(result.firebaseUid).toBe('firebase-123');
      expect(result.role).toBe('driver');
      expect(result.fullName).toBe('John Doe');
      expect(result.phone).toBe('1234567890');
      expect(result.email).toBe('john@example.com');
      expect(result.companyName).toBe('Truxify Inc');
      expect(result.avatarUrl).toBe('https://example.com/avatar.jpg');
      expect(result.language).toBe('en');
      expect(result.darkMode).toBe(true);
      expect(result.isActive).toBe(true);
      expect(result.walletAddress).toBe('0x1234');
      expect(result.polygonWalletAddress).toBe('0x5678');
    });

    it('handles null/undefined input gracefully', () => {
      expect(ProfileModel.fromProfile(null)).toBeNull();
      expect(ProfileModel.fromProfile(undefined)).toBeNull();
    });

    it('applies defaults for missing fields', () => {
      const result = ProfileModel.fromProfile({ id: 'uuid-1' });

      expect(result.firebaseUid).toBeNull();
      expect(result.role).toBe('user');
      expect(result.fullName).toBe('');
      expect(result.phone).toBe('');
      expect(result.email).toBe('');
      expect(result.companyName).toBe('');
      expect(result.avatarUrl).toBe('');
      expect(result.language).toBe('en');
      expect(result.darkMode).toBe(false);
      expect(result.isActive).toBe(false);
      expect(result.walletAddress).toBeNull();
      expect(result.polygonWalletAddress).toBeNull();
    });
  });

  describe('fromCustomerStats', () => {
    it('normalizes customer stats correctly', () => {
      const stats = {
        total_orders: 150,
        total_saved: 500,
        co2_reduced_kg: 1200,
      };

      const result = ProfileModel.fromCustomerStats(stats);

      expect(result.totalOrders).toBe(150);
      expect(result.totalSaved).toBe(500);
      expect(result.co2ReducedKg).toBe(1200);
    });

    it('handles null/undefined input gracefully', () => {
      expect(ProfileModel.fromCustomerStats(null)).toBeNull();
      expect(ProfileModel.fromCustomerStats(undefined)).toBeNull();
    });

    it('applies defaults for missing fields', () => {
      const result = ProfileModel.fromCustomerStats({});
      expect(result.totalOrders).toBe(0);
      expect(result.totalSaved).toBe(0);
      expect(result.co2ReducedKg).toBe(0);
    });
  });

  describe('fromDriverDetails', () => {
    it('normalizes driver details correctly', () => {
      const details = {
        truck_id: 'truck-1',
        rating: 4.8,
        total_trips: 500,
        completion_rate: 95.5,
        is_online: true,
        wallet_confirmed: 1000,
        wallet_pending: 500,
        wallet_total: 1500,
        kyc_status: 'Verified',
        kyc_doc_number: 'ABC123',
      };

      const result = ProfileModel.fromDriverDetails(details);

      expect(result.truckId).toBe('truck-1');
      expect(result.rating).toBe(4.8);
      expect(result.totalTrips).toBe(500);
      expect(result.completionRate).toBe(95.5);
      expect(result.isOnline).toBe(true);
      expect(result.walletConfirmed).toBe(1000);
      expect(result.walletPending).toBe(500);
      expect(result.walletTotal).toBe(1500);
      expect(result.kycStatus).toBe('Verified');
      expect(result.kycDocNumber).toBe('ABC123');
    });

    it('handles null/undefined input gracefully', () => {
      expect(ProfileModel.fromDriverDetails(null)).toBeNull();
      expect(ProfileModel.fromDriverDetails(undefined)).toBeNull();
    });

    it('awards badges based on achievements', () => {
      // First delivery badge
      const firstDelivery = ProfileModel.fromDriverDetails({ total_trips: 1 });
      expect(firstDelivery.badges).toContainEqual(expect.objectContaining({ id: 'first_delivery' }));

      // 100 deliveries badge
      const hundredDeliveries = ProfileModel.fromDriverDetails({ total_trips: 100 });
      expect(hundredDeliveries.badges).toContainEqual(expect.objectContaining({ id: '100_deliveries' }));

      // 5-star driver badge (4.9+ rating with trips)
      const fiveStar = ProfileModel.fromDriverDetails({ rating: 4.9, total_trips: 50 });
      expect(fiveStar.badges).toContainEqual(expect.objectContaining({ id: '5_star' }));

      // Top earner badge
      const topEarner = ProfileModel.fromDriverDetails({ wallet_total: 1000 });
      expect(topEarner.badges).toContainEqual(expect.objectContaining({ id: 'top_earner' }));

      // Long distance champion badge
      const champion = ProfileModel.fromDriverDetails({ total_trips: 500 });
      expect(champion.badges).toContainEqual(expect.objectContaining({ id: 'long_distance_champion' }));
    });
  });

  describe('mergeProfileData', () => {
    it('merges profile, stats, and driver details', () => {
      const profile = { id: 'uuid-1', full_name: 'John' };
      const stats = { total_orders: 10 };
      const driverDetails = { rating: 4.5 };

      const result = ProfileModel.mergeProfileData(profile, stats, driverDetails);

      expect(result.id).toBe('uuid-1');
      expect(result.fullName).toBe('John');
      expect(result.customerStats.totalOrders).toBe(10);
      expect(result.driverDetails.rating).toBe(4.5);
    });
  });
});
