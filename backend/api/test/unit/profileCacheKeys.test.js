import { describe, it, expect } from 'vitest';
import {
  firebaseProfileKey,
  supabaseProfileKey,
  customerStatsKey,
  driverDetailsKey,
  PROFILE_KEY_PREFIX,
} from '../../src/cache/profileCacheKeys.js';

describe('profileCacheKeys', () => {
  describe('PROFILE_KEY_PREFIX', () => {
    it('is "user:profile"', () => {
      expect(PROFILE_KEY_PREFIX).toBe('user:profile');
    });
  });

  describe('firebaseProfileKey', () => {
    it('generates correct key for a standard Firebase UID', () => {
      expect(firebaseProfileKey('abc123def456')).toBe('user:profile:abc123def456');
    });

    it('generates correct key for a long Firebase UID', () => {
      const uid = 'a'.repeat(128);
      expect(firebaseProfileKey(uid)).toBe(`user:profile:${uid}`);
    });

    it('returns a string', () => {
      expect(typeof firebaseProfileKey('uid')).toBe('string');
    });

    it('starts with the profile key prefix', () => {
      expect(firebaseProfileKey('test')).toMatch(/^user:profile:/);
    });
  });

  describe('supabaseProfileKey', () => {
    it('generates correct key for a standard UUID', () => {
      expect(supabaseProfileKey('550e8400-e29b-41d4-a716-446655440000'))
        .toBe('user:profile:sb:550e8400-e29b-41d4-a716-446655440000');
    });

    it('generates correct key for a short ID', () => {
      expect(supabaseProfileKey('short-id')).toBe('user:profile:sb:short-id');
    });

    it('returns a string', () => {
      expect(typeof supabaseProfileKey('id')).toBe('string');
    });

    it('starts with the profile key prefix and sb namespace', () => {
      expect(supabaseProfileKey('test')).toMatch(/^user:profile:sb:/);
    });
  });

  describe('customerStatsKey', () => {
    it('generates correct key for a standard UUID', () => {
      expect(customerStatsKey('550e8400-e29b-41d4-a716-446655440000'))
        .toBe('user:profile:sb:550e8400-e29b-41d4-a716-446655440000:stats');
    });

    it('generates correct key for a short ID', () => {
      expect(customerStatsKey('short-id')).toBe('user:profile:sb:short-id:stats');
    });

    it('returns a string', () => {
      expect(typeof customerStatsKey('id')).toBe('string');
    });

    it('starts with the profile key prefix and sb namespace', () => {
      expect(customerStatsKey('test')).toMatch(/^user:profile:sb:/);
    });

    it('ends with :stats segment', () => {
      expect(customerStatsKey('test')).toMatch(/:stats$/);
    });
  });

  describe('driverDetailsKey', () => {
    it('generates correct key for a standard UUID', () => {
      expect(driverDetailsKey('550e8400-e29b-41d4-a716-446655440000'))
        .toBe('user:profile:sb:550e8400-e29b-41d4-a716-446655440000:driver');
    });

    it('generates correct key for a short ID', () => {
      expect(driverDetailsKey('short-id')).toBe('user:profile:sb:short-id:driver');
    });

    it('returns a string', () => {
      expect(typeof driverDetailsKey('id')).toBe('string');
    });

    it('starts with the profile key prefix and sb namespace', () => {
      expect(driverDetailsKey('test')).toMatch(/^user:profile:sb:/);
    });

    it('ends with :driver segment', () => {
      expect(driverDetailsKey('test')).toMatch(/:driver$/);
    });
  });

  describe('key separation', () => {
    it('Firebase and Supabase keys for the same ID are different', () => {
      const id = '550e8400-e29b-41d4-a716-446655440000';
      expect(firebaseProfileKey(id)).not.toBe(supabaseProfileKey(id));
    });

    it('Firebase key does not contain "sb:" segment', () => {
      expect(firebaseProfileKey('test')).not.toContain(':sb:');
    });

    it('Supabase key contains "sb:" segment', () => {
      expect(supabaseProfileKey('test')).toContain(':sb:');
    });

    it('all Supabase-scoped keys for the same user are distinct', () => {
      const userId = '550e8400-e29b-41d4-a716-446655440000';
      const profile = supabaseProfileKey(userId);
      const stats = customerStatsKey(userId);
      const driver = driverDetailsKey(userId);
      const allKeys = new Set([profile, stats, driver]);
      expect(allKeys.size).toBe(3);
    });
  });
});
