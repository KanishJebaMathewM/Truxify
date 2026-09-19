import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidCachedProfile,
  isValidCachedSupabaseProfile,
  isValidProfile,
  getCacheStats,
  resetCacheStats,
} from '../../../backend/api/src/lib/profileCache.js';

describe('profileCache - Validation & Null Guards', () => {
  beforeEach(() => {
    resetCacheStats();
  });

  describe('isValidCachedProfile', () => {
    const validUid = 'firebase-user-123';
    const validActiveProfile = {
      id: 'profile-uuid-1',
      uid: validUid,
      role: 'customer',
      isActive: true,
      fullName: 'Alice Smith',
      phone: '+1234567890',
    };

    it('returns false when cachedProfile is null or undefined (guard against typeof null === object)', () => {
      expect(isValidCachedProfile(validUid, null)).toBe(false);
      expect(isValidCachedProfile(validUid, undefined)).toBe(false);
    });

    it('returns false when cachedProfile is not an object or is an array', () => {
      expect(isValidCachedProfile(validUid, 'string-profile')).toBe(false);
      expect(isValidCachedProfile(validUid, 12345)).toBe(false);
      expect(isValidCachedProfile(validUid, true)).toBe(false);
      expect(isValidCachedProfile(validUid, [])).toBe(false);
      expect(isValidCachedProfile(validUid, [validActiveProfile])).toBe(false);
    });

    it('returns false when firebaseUid is invalid or empty', () => {
      expect(isValidCachedProfile(null, validActiveProfile)).toBe(false);
      expect(isValidCachedProfile(undefined, validActiveProfile)).toBe(false);
      expect(isValidCachedProfile('', validActiveProfile)).toBe(false);
      expect(isValidCachedProfile('   ', validActiveProfile)).toBe(false);
      expect(isValidCachedProfile(12345, validActiveProfile)).toBe(false);
    });

    it('returns true for valid active profile with matching UID', () => {
      expect(isValidCachedProfile(validUid, validActiveProfile)).toBe(true);
    });

    it('returns true for valid tombstone (isActive === false)', () => {
      const tombstone = { isActive: false };
      expect(isValidCachedProfile(validUid, tombstone)).toBe(true);
    });

    it('returns false when isActive is missing or not a boolean', () => {
      expect(isValidCachedProfile(validUid, { ...validActiveProfile, isActive: 'true' })).toBe(false);
      expect(isValidCachedProfile(validUid, { ...validActiveProfile, isActive: null })).toBe(false);
      expect(isValidCachedProfile(validUid, { ...validActiveProfile, isActive: undefined })).toBe(false);
    });

    it('returns false when UID does not match the requested firebaseUid', () => {
      expect(isValidCachedProfile(validUid, { ...validActiveProfile, uid: 'different-uid' })).toBe(false);
    });

    it('returns false when id or role is missing or empty', () => {
      expect(isValidCachedProfile(validUid, { ...validActiveProfile, id: '' })).toBe(false);
      expect(isValidCachedProfile(validUid, { ...validActiveProfile, id: null })).toBe(false);
      expect(isValidCachedProfile(validUid, { ...validActiveProfile, role: '' })).toBe(false);
      expect(isValidCachedProfile(validUid, { ...validActiveProfile, role: null })).toBe(false);
    });

    it('validates optional fullName and phone fields correctly', () => {
      const withNulls = { ...validActiveProfile, fullName: null, phone: null };
      expect(isValidCachedProfile(validUid, withNulls)).toBe(true);

      const withNonStrings = { ...validActiveProfile, fullName: 123 };
      expect(isValidCachedProfile(validUid, withNonStrings)).toBe(false);

      const withPhoneObject = { ...validActiveProfile, phone: {} };
      expect(isValidCachedProfile(validUid, withPhoneObject)).toBe(false);
    });
  });

  describe('isValidCachedSupabaseProfile', () => {
    const validUserId = 'supabase-uuid-456';
    const validSbProfile = {
      id: validUserId,
      role: 'driver',
      isActive: true,
      fullName: 'Bob Driver',
    };

    it('returns false when cachedProfile is null or undefined', () => {
      expect(isValidCachedSupabaseProfile(validUserId, null)).toBe(false);
      expect(isValidCachedSupabaseProfile(validUserId, undefined)).toBe(false);
    });

    it('returns false when cachedProfile is not an object or is an array', () => {
      expect(isValidCachedSupabaseProfile(validUserId, 'profile-str')).toBe(false);
      expect(isValidCachedSupabaseProfile(validUserId, 999)).toBe(false);
      expect(isValidCachedSupabaseProfile(validUserId, [])).toBe(false);
    });

    it('returns true for valid active Supabase profile with matching ID', () => {
      expect(isValidCachedSupabaseProfile(validUserId, validSbProfile)).toBe(true);
    });

    it('returns true for valid tombstone', () => {
      expect(isValidCachedSupabaseProfile(validUserId, { isActive: false })).toBe(true);
    });

    it('returns false when userId does not match', () => {
      expect(isValidCachedSupabaseProfile(validUserId, { ...validSbProfile, id: 'mismatched-id' })).toBe(false);
    });
  });

  describe('isValidProfile', () => {
    it('returns false for null, undefined, and non-objects', () => {
      expect(isValidProfile(null)).toBe(false);
      expect(isValidProfile(undefined)).toBe(false);
      expect(isValidProfile('string')).toBe(false);
      expect(isValidProfile(123)).toBe(false);
      expect(isValidProfile([])).toBe(false);
    });

    it('returns true for valid profile object with valid createdAt date', () => {
      const valid = {
        id: 'user-1',
        createdAt: '2026-09-19T10:00:00.000Z',
      };
      expect(isValidProfile(valid)).toBe(true);
    });

    it('returns false for invalid date or missing id', () => {
      expect(isValidProfile({ id: '', createdAt: '2026-09-19T10:00:00.000Z' })).toBe(false);
      expect(isValidProfile({ id: 'u1', createdAt: 'invalid-date' })).toBe(false);
    });
  });

  describe('Cache Statistics', () => {
    it('initializes and calculates cache statistics', () => {
      const stats = getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.total).toBe(0);
      expect(stats.hitRate).toBe('0%');
    });
  });
});
