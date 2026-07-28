/**
 * Unit tests for backend/api/src/models/ProfileModel.js
 *
 * Run with:  npm run test:unit -- test/unit/profileModel.test.js
 */
import { describe, it, expect } from 'vitest';
import { ProfileModel } from '../../src/models/ProfileModel.js';

describe('ProfileModel', () => {
  describe('fromProfile', () => {
    it('returns null when profile is null (undefined triggers default parameter)', () => {
      expect(ProfileModel.fromProfile(null)).toBe(null);
      // Note: undefined triggers the default parameter = {} so returns default object
      expect(ProfileModel.fromProfile(undefined)).toEqual({
        id: null, firebaseUid: null, role: 'user', fullName: '', phone: '',
        email: '', companyName: '', avatarUrl: '', language: 'en', darkMode: false,
        isActive: false, walletAddress: null, polygonWalletAddress: null,
      });
    });

    it('maps all snake_case DB fields to camelCase response fields', () => {
      const profile = {
        id: 'prof-123',
        firebase_uid: 'fb-abc',
        role: 'driver',
        full_name: 'Ravi Kumar',
        phone: '+919876543210',
        email: 'ravi@example.com',
        company_name: 'Truxify Logistics',
        avatar_url: 'https://cdn.example.com/ravi.jpg',
        language: 'hi',
        dark_mode: true,
        is_active: true,
        wallet_address: '0xABC123',
        polygon_wallet_address: '0xDEF456',
      };

      const result = ProfileModel.fromProfile(profile);

      expect(result.id).toBe('prof-123');
      expect(result.firebaseUid).toBe('fb-abc');
      expect(result.role).toBe('driver');
      expect(result.fullName).toBe('Ravi Kumar');
      expect(result.phone).toBe('+919876543210');
      expect(result.email).toBe('ravi@example.com');
      expect(result.companyName).toBe('Truxify Logistics');
      expect(result.avatarUrl).toBe('https://cdn.example.com/ravi.jpg');
      expect(result.language).toBe('hi');
      expect(result.darkMode).toBe(true);
      expect(result.isActive).toBe(true);
      expect(result.walletAddress).toBe('0xABC123');
      expect(result.polygonWalletAddress).toBe('0xDEF456');
    });

    it('applies sensible defaults for missing fields', () => {
      const result = ProfileModel.fromProfile({});

      expect(result.id).toBe(null);
      expect(result.firebaseUid).toBe(null);
      expect(result.role).toBe('user');
      expect(result.fullName).toBe('');
      expect(result.phone).toBe('');
      expect(result.email).toBe('');
      expect(result.companyName).toBe('');
      expect(result.avatarUrl).toBe('');
      expect(result.language).toBe('en');
      expect(result.darkMode).toBe(false);
      expect(result.isActive).toBe(false);
      expect(result.walletAddress).toBe(null);
      expect(result.polygonWalletAddress).toBe(null);
    });

    it('handles null individual fields gracefully', () => {
      const profile = {
        id: null,
        firebase_uid: null,
        full_name: null,
        phone: null,
        email: null,
        is_active: null,
      };

      const result = ProfileModel.fromProfile(profile);

      expect(result.id).toBe(null);
      expect(result.firebaseUid).toBe(null);
      expect(result.fullName).toBe(''); // null coalescing returns null for null input, then ?? null
      expect(result.phone).toBe('');
      expect(result.email).toBe('');
      expect(result.isActive).toBe(false); // Boolean(null) === false
    });
  });

  describe('fromCustomerStats', () => {
    it('returns null when stats is null (undefined triggers default parameter)', () => {
      expect(ProfileModel.fromCustomerStats(null)).toBe(null);
      expect(ProfileModel.fromCustomerStats(undefined)).toEqual({ totalOrders: 0, totalSaved: 0, co2ReducedKg: 0 });
    });

    it('maps snake_case DB fields correctly', () => {
      const stats = {
        total_orders: 42,
        total_saved: 1050,
        co2_reduced_kg: 320.5,
      };

      const result = ProfileModel.fromCustomerStats(stats);

      expect(result.totalOrders).toBe(42);
      expect(result.totalSaved).toBe(1050);
      expect(result.co2ReducedKg).toBe(320.5);
    });

    it('applies defaults for missing fields', () => {
      const result = ProfileModel.fromCustomerStats({});

      expect(result.totalOrders).toBe(0);
      expect(result.totalSaved).toBe(0);
      expect(result.co2ReducedKg).toBe(0);
    });
  });

  describe('fromDriverDetails', () => {
    it('returns null when details is null (undefined triggers default parameter)', () => {
      expect(ProfileModel.fromDriverDetails(null)).toBe(null);
      expect(ProfileModel.fromDriverDetails(undefined)).toEqual({
        truckId: null, rating: 0, totalTrips: 0, completionRate: 0,
        isOnline: false, walletConfirmed: 0, walletPending: 0, walletTotal: 0,
      });
    });

    it('maps all driver fields correctly', () => {
      const details = {
        truck_id: 'truck-789',
        rating: 4.8,
        total_trips: 150,
        completion_rate: 0.97,
        is_online: true,
        wallet_confirmed: 5000,
        wallet_pending: 1200,
        wallet_total: 6200,
      };

      const result = ProfileModel.fromDriverDetails(details);

      expect(result.truckId).toBe('truck-789');
      expect(result.rating).toBe(4.8);
      expect(result.totalTrips).toBe(150);
      expect(result.completionRate).toBe(0.97);
      expect(result.isOnline).toBe(true);
      expect(result.walletConfirmed).toBe(5000);
      expect(result.walletPending).toBe(1200);
      expect(result.walletTotal).toBe(6200);
    });

    it('applies defaults for missing fields', () => {
      const result = ProfileModel.fromDriverDetails({});

      expect(result.truckId).toBe(null);
      expect(result.rating).toBe(0);
      expect(result.totalTrips).toBe(0);
      expect(result.completionRate).toBe(0);
      expect(result.isOnline).toBe(false);
      expect(result.walletConfirmed).toBe(0);
      expect(result.walletPending).toBe(0);
      expect(result.walletTotal).toBe(0);
    });
  });

  describe('mergeProfileData', () => {
    it('merges profile, customerStats, and driverDetails into one object', () => {
      const profile = {
        id: 'prof-123',
        role: 'driver',
        full_name: 'Anita Singh',
      };
      const stats = {
        total_orders: 20,
        total_saved: 800,
      };
      const driverDetails = {
        truck_id: 'truck-1',
        rating: 4.5,
      };

      const result = ProfileModel.mergeProfileData(profile, stats, driverDetails);

      // fromProfile fields
      expect(result.id).toBe('prof-123');
      expect(result.fullName).toBe('Anita Singh');
      // fromCustomerStats
      expect(result.customerStats.totalOrders).toBe(20);
      expect(result.customerStats.totalSaved).toBe(800);
      // fromDriverDetails
      expect(result.driverDetails.truckId).toBe('truck-1');
      expect(result.driverDetails.rating).toBe(4.5);
    });

    it('handles null inputs gracefully', () => {
      // null inputs to fromProfile/fromCustomerStats/fromDriverDetails return null,
      // and spreading null gives {}. The result is { customerStats: null, driverDetails: null }.
      const result = ProfileModel.mergeProfileData(null, null, null);

      expect(result.customerStats).toBe(null);
      expect(result.driverDetails).toBe(null);
    });

    it('partial merge with only profile data', () => {
      const profile = {
        id: 'prof-456',
        full_name: 'Ravi Kumar',
      };

      const result = ProfileModel.mergeProfileData(profile, null, null);

      expect(result.id).toBe('prof-456');
      expect(result.fullName).toBe('Ravi Kumar');
      expect(result.customerStats).toBe(null);
      expect(result.driverDetails).toBe(null);
    });
  });
});
