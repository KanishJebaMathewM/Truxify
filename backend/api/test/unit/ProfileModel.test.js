import { describe, it, expect } from 'vitest';
import { ProfileModel } from '../../src/models/ProfileModel.js';

describe('ProfileModel', () => {
  describe('fromProfile', () => {
    it('maps all fields from a raw profile row', () => {
      const raw = {
        id: 'uuid-1',
        firebase_uid: 'firebase-uid-1',
        role: 'driver',
        full_name: 'John Doe',
        phone: '+919876543210',
        email: 'john@example.com',
        company_name: 'Truxify',
        avatar_url: 'https://example.com/avatar.jpg',
        language: 'en',
        dark_mode: true,
        is_active: true,
        wallet_address: '0xABC',
        polygon_wallet_address: '0xDEF',
      };

      const result = ProfileModel.fromProfile(raw);

      expect(result.id).toBe('uuid-1');
      expect(result.firebaseUid).toBe('firebase-uid-1');
      expect(result.role).toBe('driver');
      expect(result.fullName).toBe('John Doe');
      expect(result.phone).toBe('+919876543210');
      expect(result.email).toBe('john@example.com');
      expect(result.companyName).toBe('Truxify');
      expect(result.avatarUrl).toBe('https://example.com/avatar.jpg');
      expect(result.language).toBe('en');
      expect(result.darkMode).toBe(true);
      expect(result.isActive).toBe(true);
      expect(result.walletAddress).toBe('0xABC');
      expect(result.polygonWalletAddress).toBe('0xDEF');
    });

    it('applies safe defaults when fields are missing', () => {
      const result = ProfileModel.fromProfile({});

      expect(result.id).toBeNull();
      expect(result.firebaseUid).toBeNull();
      expect(result.role).toBe('user');
      expect(result.fullName).toBe('');
      expect(result.language).toBe('en');
      expect(result.darkMode).toBe(false);
      expect(result.isActive).toBe(false);
    });

    it('returns null when passed null', () => {
      expect(ProfileModel.fromProfile(null)).toBeNull();
    });
  });

  describe('fromCustomerStats', () => {
    it('maps customer stats correctly', () => {
      const raw = { total_orders: 10, total_saved: 500, co2_reduced_kg: 25 };
      const result = ProfileModel.fromCustomerStats(raw);

      expect(result.totalOrders).toBe(10);
      expect(result.totalSaved).toBe(500);
      expect(result.co2ReducedKg).toBe(25);
    });

    it('defaults all fields to 0 when empty', () => {
      const result = ProfileModel.fromCustomerStats({});

      expect(result.totalOrders).toBe(0);
      expect(result.totalSaved).toBe(0);
      expect(result.co2ReducedKg).toBe(0);
    });

    it('returns null when passed null', () => {
      expect(ProfileModel.fromCustomerStats(null)).toBeNull();
    });
  });

  describe('fromDriverDetails', () => {
    it('maps driver details correctly', () => {
      const raw = {
        truck_id: 'truck-1',
        rating: 4.8,
        total_trips: 120,
        completion_rate: 98.5,
        is_online: true,
        wallet_confirmed: 5000,
        wallet_pending: 200,
        wallet_total: 5200,
        kyc_status: 'Verified',
        kyc_doc_number: 'DOC123',
      };

      const result = ProfileModel.fromDriverDetails(raw);

      expect(result.truckId).toBe('truck-1');
      expect(result.rating).toBe(4.8);
      expect(result.totalTrips).toBe(120);
      expect(result.completionRate).toBe(98.5);
      expect(result.isOnline).toBe(true);
      expect(result.walletConfirmed).toBe(5000);
      expect(result.walletTotal).toBe(5200);
      expect(result.kycStatus).toBe('Verified');
      expect(result.kycDocNumber).toBe('DOC123');
    });

    it('awards first_delivery badge at 1 trip', () => {
      const result = ProfileModel.fromDriverDetails({ total_trips: 1, rating: 4.0, wallet_total: 0 });
      expect(result.badges.some(b => b.id === 'first_delivery')).toBe(true);
    });

    it('awards 100_deliveries badge at 100 trips', () => {
      const result = ProfileModel.fromDriverDetails({ total_trips: 100, rating: 4.0, wallet_total: 0 });
      expect(result.badges.some(b => b.id === '100_deliveries')).toBe(true);
    });

    it('awards 5_star badge when rating >= 4.9 and trips > 0', () => {
      const result = ProfileModel.fromDriverDetails({ total_trips: 10, rating: 4.9, wallet_total: 0 });
      expect(result.badges.some(b => b.id === '5_star')).toBe(true);
    });

    it('does not award 5_star badge when trips = 0', () => {
      const result = ProfileModel.fromDriverDetails({ total_trips: 0, rating: 5.0, wallet_total: 0 });
      expect(result.badges.some(b => b.id === '5_star')).toBe(false);
    });

    it('returns null when passed null', () => {
      expect(ProfileModel.fromDriverDetails(null)).toBeNull();
    });
  });

  describe('mergeProfileData', () => {
    it('merges profile, stats and driver details into one object', () => {
      const profile = { id: 'uuid-1', role: 'driver', full_name: 'John' };
      const stats = { total_orders: 5, total_saved: 100, co2_reduced_kg: 10 };
      const details = { total_trips: 50, rating: 4.5, wallet_total: 2000 };

      const result = ProfileModel.mergeProfileData(profile, stats, details);

      expect(result.id).toBe('uuid-1');
      expect(result.customerStats.totalOrders).toBe(5);
      expect(result.driverDetails.totalTrips).toBe(50);
    });

    it('handles null stats and details gracefully', () => {
      const profile = { id: 'uuid-2', role: 'customer' };
      const result = ProfileModel.mergeProfileData(profile, null, null);

      expect(result.id).toBe('uuid-2');
      expect(result.customerStats).toBeNull();
      expect(result.driverDetails).toBeNull();
    });
  });
});