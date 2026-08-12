import { describe, it, expect } from 'vitest';
import { ProfileModel } from '../../src/models/ProfileModel.js';

describe('ProfileModel.fromProfile', () => {
  it('returns null for a null profile', () => {
    expect(ProfileModel.fromProfile(null)).toBeNull();
  });

  it('normalizes a raw profile row', () => {
    const profile = ProfileModel.fromProfile({
      id: 'u1',
      firebase_uid: 'fb-1',
      role: 'driver',
      full_name: 'Jane Driver',
      phone: '+919999999999',
      email: 'jane@example.com',
      company_name: 'Acme',
      avatar_url: 'https://cdn.example.com/a.png',
      language: 'hi',
      dark_mode: true,
      is_active: true,
      wallet_address: '0xabc',
      polygon_wallet_address: '0xdef',
    });
    expect(profile).toEqual({
      id: 'u1',
      firebaseUid: 'fb-1',
      role: 'driver',
      fullName: 'Jane Driver',
      phone: '+919999999999',
      email: 'jane@example.com',
      companyName: 'Acme',
      avatarUrl: 'https://cdn.example.com/a.png',
      language: 'hi',
      darkMode: true,
      isActive: true,
      walletAddress: '0xabc',
      polygonWalletAddress: '0xdef',
    });
  });

  it('applies defaults for missing fields', () => {
    const profile = ProfileModel.fromProfile({ id: 'u1' });
    expect(profile.role).toBe('user');
    expect(profile.fullName).toBe('');
    expect(profile.darkMode).toBe(false);
    expect(profile.isActive).toBe(false);
    expect(profile.language).toBe('en');
    expect(profile.walletAddress).toBeNull();
  });
});

describe('ProfileModel.fromCustomerStats', () => {
  it('returns null for null stats', () => {
    expect(ProfileModel.fromCustomerStats(null)).toBeNull();
  });

  it('maps stats with defaults', () => {
    expect(ProfileModel.fromCustomerStats({})).toEqual({
      totalOrders: 0,
      totalSaved: 0,
      co2ReducedKg: 0,
    });
    expect(ProfileModel.fromCustomerStats({ total_orders: 5, total_saved: 120, co2_reduced_kg: 30 })).toEqual({
      totalOrders: 5,
      totalSaved: 120,
      co2ReducedKg: 30,
    });
  });
});

describe('ProfileModel.fromDriverDetails', () => {
  it('returns null for null details', () => {
    expect(ProfileModel.fromDriverDetails(null)).toBeNull();
  });

  it('applies defaults for empty details', () => {
    const details = ProfileModel.fromDriverDetails({});
    expect(details.rating).toBe(0);
    expect(details.totalTrips).toBe(0);
    expect(details.badges).toEqual([]);
    expect(details.kycStatus).toBe('Unverified');
  });

  it('awards badges based on thresholds', () => {
    const details = ProfileModel.fromDriverDetails({
      total_trips: 500,
      rating: 4.9,
      wallet_total: 5000,
    });
    const badgeIds = details.badges.map((b) => b.id);
    expect(badgeIds).toContain('first_delivery');
    expect(badgeIds).toContain('100_deliveries');
    expect(badgeIds).toContain('5_star');
    expect(badgeIds).toContain('top_earner');
    expect(badgeIds).toContain('long_distance_champion');
  });

  it('does not award the 5-star badge without completed trips', () => {
    const details = ProfileModel.fromDriverDetails({ rating: 4.9, total_trips: 0 });
    expect(details.badges.map((b) => b.id)).not.toContain('5_star');
  });
});

describe('ProfileModel.mergeProfileData', () => {
  it('merges profile, stats, and driver details', () => {
    const merged = ProfileModel.mergeProfileData(
      { id: 'u1', role: 'driver' },
      { total_orders: 3 },
      { total_trips: 10, rating: 4.5 },
    );
    expect(merged.id).toBe('u1');
    expect(merged.role).toBe('driver');
    expect(merged.customerStats.totalOrders).toBe(3);
    expect(merged.driverDetails.totalTrips).toBe(10);
    expect(merged.driverDetails.rating).toBe(4.5);
  });
});
