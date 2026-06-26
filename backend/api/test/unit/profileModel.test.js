/**
 * Unit tests for backend/api/src/models/ProfileModel.js
 *
 * Coverage:
 *   - fromProfile maps all profile fields correctly
 *   - fromProfile handles null/undefined input
 *   - fromCustomerStats maps customer stats fields correctly
 *   - fromCustomerStats returns null for null/undefined input
 *   - fromDriverDetails maps driver details fields correctly
 *   - fromDriverDetails returns null for null/undefined input
 *
 * Run with:  npm run test:unit -- test/unit/profileModel.test.js
 */
import { describe, it, expect } from 'vitest';
import { ProfileModel } from '../../src/models/ProfileModel.js';

describe('ProfileModel.fromProfile', () => {
  it('maps all profile fields correctly', () => {
    const profile = {
      id: 'profile-123',
      firebase_uid: 'firebase-uid-abc',
      role: 'driver',
      full_name: 'Ramesh Kumar',
      phone: '+919876543210',
      email: 'ramesh@example.com',
      company_name: 'Ramesh Logistics',
      avatar_url: 'https://example.com/avatar.png',
      language: 'en',
      dark_mode: true,
      is_active: true,
      wallet_address: '0xABC123',
      polygon_wallet_address: '0xDEF456',
    };

    const result = ProfileModel.fromProfile(profile);

    expect(result).toEqual({
      id: 'profile-123',
      firebaseUid: 'firebase-uid-abc',
      role: 'driver',
      fullName: 'Ramesh Kumar',
      phone: '+919876543210',
      email: 'ramesh@example.com',
      companyName: 'Ramesh Logistics',
      avatarUrl: 'https://example.com/avatar.png',
      language: 'en',
      darkMode: true,
      isActive: true,
      walletAddress: '0xABC123',
      polygonWalletAddress: '0xDEF456',
    });
  });

  it('handles missing optional fields', () => {
    const profile = {
      id: 'profile-456',
      firebase_uid: 'firebase-uid-def',
      role: 'customer',
      full_name: null,
      phone: null,
      email: null,
      company_name: null,
      avatar_url: null,
      language: null,
      dark_mode: null,
      is_active: null,
      wallet_address: null,
      polygon_wallet_address: null,
    };

    const result = ProfileModel.fromProfile(profile);

    expect(result.id).toBe('profile-456');
    expect(result.fullName).toBeNull();
    expect(result.walletAddress).toBeNull();
    expect(result.polygonWalletAddress).toBeNull();
  });

  it('throws TypeError when input is undefined', () => {
    expect(() => ProfileModel.fromProfile(undefined)).toThrow(TypeError);
  });

  it('throws TypeError when input is null', () => {
    expect(() => ProfileModel.fromProfile(null)).toThrow(TypeError);
  });
});

describe('ProfileModel.fromCustomerStats', () => {
  it('maps customer stats fields correctly', () => {
    const stats = {
      total_orders: 127,
      total_saved: 45890,
      co2_reduced_kg: 342.5,
    };

    const result = ProfileModel.fromCustomerStats(stats);

    expect(result).toEqual({
      totalOrders: 127,
      totalSaved: 45890,
      co2ReducedKg: 342.5,
    });
  });

  it('returns null for null input', () => {
    expect(ProfileModel.fromCustomerStats(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(ProfileModel.fromCustomerStats(undefined)).toBeNull();
  });

  it('maps partial stats fields', () => {
    const stats = { total_orders: 5 };

    const result = ProfileModel.fromCustomerStats(stats);

    expect(result.totalOrders).toBe(5);
    expect(result.totalSaved).toBeUndefined();
    expect(result.co2ReducedKg).toBeUndefined();
  });
});

describe('ProfileModel.fromDriverDetails', () => {
  it('maps driver details fields correctly', () => {
    const details = {
      truck_id: 'truck-789',
      rating: 4.7,
      total_trips: 203,
      completion_rate: 0.94,
      is_online: true,
      wallet_confirmed: 250000,
      wallet_pending: 5000,
      wallet_total: 255000,
    };

    const result = ProfileModel.fromDriverDetails(details);

    expect(result).toEqual({
      truckId: 'truck-789',
      rating: 4.7,
      totalTrips: 203,
      completionRate: 0.94,
      isOnline: true,
      walletConfirmed: 250000,
      walletPending: 5000,
      walletTotal: 255000,
    });
  });

  it('returns null for null input', () => {
    expect(ProfileModel.fromDriverDetails(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(ProfileModel.fromDriverDetails(undefined)).toBeNull();
  });

  it('maps partial driver details', () => {
    const details = { rating: 3.5, total_trips: 10 };

    const result = ProfileModel.fromDriverDetails(details);

    expect(result.rating).toBe(3.5);
    expect(result.totalTrips).toBe(10);
    expect(result.truckId).toBeUndefined();
    expect(result.walletTotal).toBeUndefined();
  });
});
