import { describe, it, expect } from 'vitest';

import { ProfileModel } from '../../src/models/ProfileModel.js';

describe('ProfileModel', () => {
  describe('fromProfile', () => {
    it('maps a raw profile row into the normalized shape', () => {
      const profile = {
        id: 'uuid-1',
        firebase_uid: 'firebase-uid-1',
        role: 'driver',
        full_name: 'John Doe',
        phone: '+919999999999',
        email: 'john@example.com',
        company_name: 'Acme Logistics',
        avatar_url: 'https://example.com/avatar.png',
        language: 'hi',
        dark_mode: true,
        is_active: true,
        wallet_address: '0xabc',
        polygon_wallet_address: '0xdef',
      };

      const result = ProfileModel.fromProfile(profile);

      expect(result).toEqual({
        id: 'uuid-1',
        firebaseUid: 'firebase-uid-1',
        role: 'driver',
        fullName: 'John Doe',
        phone: '+919999999999',
        email: 'john@example.com',
        companyName: 'Acme Logistics',
        avatarUrl: 'https://example.com/avatar.png',
        language: 'hi',
        darkMode: true,
        isActive: true,
        walletAddress: '0xabc',
        polygonWalletAddress: '0xdef',
      });
    });

    it('applies defaults for missing fields', () => {
      const result = ProfileModel.fromProfile({});

      expect(result).toEqual({
        id: null,
        firebaseUid: null,
        role: 'user',
        fullName: '',
        phone: '',
        email: '',
        companyName: '',
        avatarUrl: '',
        language: 'en',
        darkMode: false,
        isActive: false,
        walletAddress: null,
        polygonWalletAddress: null,
      });
    });

    it('returns null when the profile is falsy', () => {
      expect(ProfileModel.fromProfile(null)).toBeNull();
      expect(ProfileModel.fromProfile(undefined)).toBeNull();
    });
  });

  describe('fromCustomerStats', () => {
    it('maps raw customer stats', () => {
      const stats = {
        total_orders: 12,
        total_saved: 3400,
        co2_reduced_kg: 45.5,
      };

      expect(ProfileModel.fromCustomerStats(stats)).toEqual({
        totalOrders: 12,
        totalSaved: 3400,
        co2ReducedKg: 45.5,
      });
    });

    it('applies zero defaults for missing fields', () => {
      expect(ProfileModel.fromCustomerStats({})).toEqual({
        totalOrders: 0,
        totalSaved: 0,
        co2ReducedKg: 0,
      });
    });

    it('returns null when stats are falsy', () => {
      expect(ProfileModel.fromCustomerStats(null)).toBeNull();
    });
  });

  describe('fromDriverDetails', () => {
    it('maps raw driver details and derives an empty badge list', () => {
      const details = {
        truck_id: 'truck-1',
        rating: 4.2,
        total_trips: 2,
        completion_rate: 95,
        is_online: true,
        wallet_confirmed: 1,
        wallet_pending: 500,
        wallet_total: 150,
        kyc_status: 'Verified',
        kyc_doc_number: 'DL-1234',
      };

      const result = ProfileModel.fromDriverDetails(details);

      expect(result.truckId).toBe('truck-1');
      expect(result.rating).toBe(4.2);
      expect(result.totalTrips).toBe(2);
      expect(result.completionRate).toBe(95);
      expect(result.isOnline).toBe(true);
      expect(result.walletConfirmed).toBe(1);
      expect(result.walletPending).toBe(500);
      expect(result.walletTotal).toBe(150);
      expect(result.kycStatus).toBe('Verified');
      expect(result.kycDocNumber).toBe('DL-1234');
      expect(result.badges).toEqual([]);
    });

    it('derives badges as milestones are reached', () => {
      const result = ProfileModel.fromDriverDetails({
        total_trips: 600,
        rating: 4.9,
        wallet_total: 2500,
      });

      expect(result.badges.map((badge) => badge.id)).toEqual([
        'first_delivery',
        '100_deliveries',
        '5_star',
        'top_earner',
        'long_distance_champion',
      ]);
    });

    it('applies defaults for missing fields', () => {
      expect(ProfileModel.fromDriverDetails({})).toEqual({
        truckId: null,
        rating: 0,
        totalTrips: 0,
        completionRate: 0,
        isOnline: false,
        walletConfirmed: 0,
        walletPending: 0,
        walletTotal: 0,
        kycStatus: 'Unverified',
        kycDocNumber: null,
        badges: [],
      });
    });

    it('returns null when details are falsy', () => {
      expect(ProfileModel.fromDriverDetails(null)).toBeNull();
    });
  });

  describe('mergeProfileData', () => {
    it('combines profile, customer stats and driver details', () => {
      const profile = { id: 'uuid-1', firebase_uid: 'f-1', role: 'driver', full_name: 'Jane Doe' };
      const stats = { total_orders: 5 };
      const details = { total_trips: 10, wallet_total: 1200 };

      const result = ProfileModel.mergeProfileData(profile, stats, details);

      expect(result.id).toBe('uuid-1');
      expect(result.firebaseUid).toBe('f-1');
      expect(result.role).toBe('driver');
      expect(result.fullName).toBe('Jane Doe');
      expect(result.customerStats).toEqual({ totalOrders: 5, totalSaved: 0, co2ReducedKg: 0 });
      expect(result.driverDetails.totalTrips).toBe(10);
      expect(result.driverDetails.walletTotal).toBe(1200);
      expect(result.driverDetails.badges.map((badge) => badge.id)).toContain('first_delivery');
    });
  });
});
