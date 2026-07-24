import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('profileCache utility', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.REDIS_CACHE_TTL;
  });

  afterEach(() => {
    vi.doUnmock('../../src/config/db.js');
  });

  describe('getCachedProfile', () => {
    it('returns null if redisClient is not defined in db.js', async () => {
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: null,
      }));

      const { getCachedProfile } = await import('../../src/lib/profileCache.js');
      const profile = await getCachedProfile('some-uid');
      expect(profile).toBeNull();
    });

    it('returns null gracefully and does not throw if db.js is mocked as an empty object (Vitest mock proxy behavior)', async () => {
      vi.doMock('../../src/config/db.js', () => ({}));

      const { getCachedProfile, setCachedProfile, invalidateCachedProfile } = await import('../../src/lib/profileCache.js');

      const profile = await getCachedProfile('some-uid');
      expect(profile).toBeNull();
      
      await expect(setCachedProfile('some-uid', { id: '123' })).resolves.toBeUndefined();
      await expect(invalidateCachedProfile('some-uid')).resolves.toBeUndefined();
    });

    it('returns null if firebaseUid is not provided', async () => {
      const redisClientMock = {
        get: vi.fn(),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const { getCachedProfile } = await import('../../src/lib/profileCache.js');
      const profile = await getCachedProfile(null);
      expect(profile).toBeNull();
      expect(redisClientMock.get).not.toHaveBeenCalled();
    });

    it('retrieves and parses cached profile on hit', async () => {
      const mockProfile = { id: 'user-123', fullName: 'Alice' };
      const redisClientMock = {
        get: vi.fn().mockResolvedValue(JSON.stringify(mockProfile)),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const { getCachedProfile } = await import('../../src/lib/profileCache.js');
      const profile = await getCachedProfile('firebase-123');
      expect(redisClientMock.get).toHaveBeenCalledWith('user:profile:firebase-123');
      expect(profile).toEqual(mockProfile);
    });

    it('returns null and logs error if JSON parsing fails', async () => {
      const redisClientMock = {
        get: vi.fn().mockResolvedValue('invalid-json-string{'),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const { default: logger } = await import('../../src/middleware/logger.js');
      vi.clearAllMocks();

      const { getCachedProfile } = await import('../../src/lib/profileCache.js');
      try {
        const profile = await getCachedProfile('firebase-123');
        expect(profile).toBeNull();
        expect(logger.error).toHaveBeenCalled();
      } finally {
      }
    });

    it('returns null and logs error if redis get throws', async () => {
      const redisClientMock = {
        get: vi.fn().mockRejectedValue(new Error('Redis connection failure')),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const { default: logger } = await import('../../src/middleware/logger.js');
      vi.clearAllMocks();

      const { getCachedProfile } = await import('../../src/lib/profileCache.js');
      try {
        const profile = await getCachedProfile('firebase-123');
        expect(profile).toBeNull();
        expect(logger.error).toHaveBeenCalled();
      } finally {
      }
    });
  });

  describe('setCachedProfile', () => {
    it('does not write and does not throw if redisClient is not defined', async () => {
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: null,
      }));

      const { setCachedProfile } = await import('../../src/lib/profileCache.js');
      await expect(setCachedProfile('firebase-123', { id: '123' })).resolves.toBeUndefined();
    });

    it('does not write if parameters are missing', async () => {
      const redisClientMock = {
        set: vi.fn(),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const { setCachedProfile } = await import('../../src/lib/profileCache.js');
      await setCachedProfile(null, { id: '123' });
      await setCachedProfile('firebase-123', null);
      expect(redisClientMock.set).not.toHaveBeenCalled();
    });

    it('calls redis set with correct parameters and TTL', async () => {
      const redisClientMock = {
        set: vi.fn().mockResolvedValue('OK'),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const mockProfile = { id: 'user-123', fullName: 'Alice' };
      const { setCachedProfile, TTL_SECONDS } = await import('../../src/lib/profileCache.js');
      await setCachedProfile('firebase-123', mockProfile);
      expect(redisClientMock.set).toHaveBeenCalledWith(
        'user:profile:firebase-123',
        JSON.stringify(mockProfile),
        'EX',
        TTL_SECONDS
      );
    });

    it('logs error if redis set throws', async () => {
      const redisClientMock = {
        set: vi.fn().mockRejectedValue(new Error('Redis read-only')),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const { default: logger } = await import('../../src/middleware/logger.js');
      vi.clearAllMocks();

      const { setCachedProfile } = await import('../../src/lib/profileCache.js');
      try {
        await setCachedProfile('firebase-123', { id: '123' });
        expect(logger.error).toHaveBeenCalled();
      } finally {
      }
    });
  });

  describe('invalidateCachedProfile', () => {
    it('does not call and does not throw if redisClient is not defined', async () => {
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: null,
      }));

      const { invalidateCachedProfile } = await import('../../src/lib/profileCache.js');
      await expect(invalidateCachedProfile('firebase-123')).resolves.toBeUndefined();
    });

    it('does not call if firebaseUid is missing', async () => {
      const redisClientMock = {
        del: vi.fn(),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const { invalidateCachedProfile } = await import('../../src/lib/profileCache.js');
      await invalidateCachedProfile(null);
      expect(redisClientMock.del).not.toHaveBeenCalled();
    });

    it('calls redis del with correct key', async () => {
      const redisClientMock = {
        del: vi.fn().mockResolvedValue(1),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const { invalidateCachedProfile } = await import('../../src/lib/profileCache.js');
      await invalidateCachedProfile('firebase-123');
      expect(redisClientMock.del).toHaveBeenCalledWith('user:profile:firebase-123');
    });

    it('logs error if redis del throws', async () => {
      const redisClientMock = {
        del: vi.fn().mockRejectedValue(new Error('Redis del fail')),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const { default: logger } = await import('../../src/middleware/logger.js');
      vi.clearAllMocks();

      const { invalidateCachedProfile } = await import('../../src/lib/profileCache.js');
      try {
        await invalidateCachedProfile('firebase-123');
        expect(logger.error).toHaveBeenCalled();
      } finally {
      }
    });
  });

  describe('getCachedSupabaseProfile', () => {
    it('returns null if redisClient is not defined', async () => {
      vi.doMock('../../src/config/db.js', () => ({ redisClient: null }));
      const { getCachedSupabaseProfile } = await import('../../src/lib/profileCache.js');
      const result = await getCachedSupabaseProfile('user-123');
      expect(result).toBeNull();
    });

    it('retrieves and parses cached profile on hit', async () => {
      const mockProfile = { id: 'user-123', role: 'driver' };
      const redisClientMock = {
        get: vi.fn().mockResolvedValue(JSON.stringify(mockProfile)),
      };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { getCachedSupabaseProfile } = await import('../../src/lib/profileCache.js');
      const result = await getCachedSupabaseProfile('user-123');
      expect(redisClientMock.get).toHaveBeenCalledWith('user:profile:sb:user-123');
      expect(result).toEqual(mockProfile);
    });

    it('returns null on cache miss', async () => {
      const redisClientMock = { get: vi.fn().mockResolvedValue(null) };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { getCachedSupabaseProfile } = await import('../../src/lib/profileCache.js');
      const result = await getCachedSupabaseProfile('user-123');
      expect(result).toBeNull();
    });

    it('returns null and cleans up corrupted key on parse error', async () => {
      const redisClientMock = {
        get: vi.fn().mockResolvedValue('invalid-json{'),
        del: vi.fn().mockResolvedValue(1),
      };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { getCachedSupabaseProfile } = await import('../../src/lib/profileCache.js');
      const result = await getCachedSupabaseProfile('user-123');
      expect(result).toBeNull();
      expect(redisClientMock.del).toHaveBeenCalledWith('user:profile:sb:user-123');
    });
  });

  describe('getCachedCustomerStats', () => {
    it('returns null if redisClient is not defined', async () => {
      vi.doMock('../../src/config/db.js', () => ({ redisClient: null }));
      const { getCachedCustomerStats } = await import('../../src/lib/profileCache.js');
      const result = await getCachedCustomerStats('user-123');
      expect(result).toBeNull();
    });

    it('retrieves cached stats on hit', async () => {
      const mockStats = { total_orders: 42, total_saved: 8 };
      const redisClientMock = {
        get: vi.fn().mockResolvedValue(JSON.stringify(mockStats)),
      };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { getCachedCustomerStats } = await import('../../src/lib/profileCache.js');
      const result = await getCachedCustomerStats('user-123');
      expect(redisClientMock.get).toHaveBeenCalledWith('user:profile:sb:user-123:stats');
      expect(result).toEqual(mockStats);
    });

    it('returns null on cache miss', async () => {
      const redisClientMock = { get: vi.fn().mockResolvedValue(null) };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { getCachedCustomerStats } = await import('../../src/lib/profileCache.js');
      const result = await getCachedCustomerStats('user-123');
      expect(result).toBeNull();
    });

    it('returns null and cleans up on parse error', async () => {
      const redisClientMock = {
        get: vi.fn().mockResolvedValue('bad-json{'),
        del: vi.fn().mockResolvedValue(1),
      };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { getCachedCustomerStats } = await import('../../src/lib/profileCache.js');
      const result = await getCachedCustomerStats('user-123');
      expect(result).toBeNull();
      expect(redisClientMock.del).toHaveBeenCalledWith('user:profile:sb:user-123:stats');
    });
  });

  describe('setCachedCustomerStats', () => {
    it('writes to Redis with correct key and TTL', async () => {
      const redisClientMock = { set: vi.fn().mockResolvedValue('OK') };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { setCachedCustomerStats, TTL_SECONDS } = await import('../../src/lib/profileCache.js');
      const stats = { total_orders: 42 };
      await setCachedCustomerStats('user-123', stats);
      expect(redisClientMock.set).toHaveBeenCalledWith(
        'user:profile:sb:user-123:stats',
        JSON.stringify(stats),
        'EX',
        TTL_SECONDS
      );
    });
  });

  describe('getCachedDriverDetails', () => {
    it('returns null if redisClient is not defined', async () => {
      vi.doMock('../../src/config/db.js', () => ({ redisClient: null }));
      const { getCachedDriverDetails } = await import('../../src/lib/profileCache.js');
      const result = await getCachedDriverDetails('user-123');
      expect(result).toBeNull();
    });

    it('retrieves cached driver details on hit', async () => {
      const mockDetails = { truck_id: 'truck-01', rating: 4.7 };
      const redisClientMock = {
        get: vi.fn().mockResolvedValue(JSON.stringify(mockDetails)),
      };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { getCachedDriverDetails } = await import('../../src/lib/profileCache.js');
      const result = await getCachedDriverDetails('user-123');
      expect(redisClientMock.get).toHaveBeenCalledWith('user:profile:sb:user-123:driver');
      expect(result).toEqual(mockDetails);
    });

    it('returns null on cache miss', async () => {
      const redisClientMock = { get: vi.fn().mockResolvedValue(null) };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { getCachedDriverDetails } = await import('../../src/lib/profileCache.js');
      const result = await getCachedDriverDetails('user-123');
      expect(result).toBeNull();
    });

    it('returns null and cleans up on parse error', async () => {
      const redisClientMock = {
        get: vi.fn().mockResolvedValue('not-json['),
        del: vi.fn().mockResolvedValue(1),
      };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { getCachedDriverDetails } = await import('../../src/lib/profileCache.js');
      const result = await getCachedDriverDetails('user-123');
      expect(result).toBeNull();
      expect(redisClientMock.del).toHaveBeenCalledWith('user:profile:sb:user-123:driver');
    });
  });

  describe('setCachedDriverDetails', () => {
    it('writes to Redis with correct key and TTL', async () => {
      const redisClientMock = { set: vi.fn().mockResolvedValue('OK') };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { setCachedDriverDetails, TTL_SECONDS } = await import('../../src/lib/profileCache.js');
      const details = { truck_id: 'truck-01', rating: 4.7 };
      await setCachedDriverDetails('user-123', details);
      expect(redisClientMock.set).toHaveBeenCalledWith(
        'user:profile:sb:user-123:driver',
        JSON.stringify(details),
        'EX',
        TTL_SECONDS
      );
    });
  });

  describe('invalidateCachedSupabaseProfileAll', () => {
    it('deletes all three Supabase profile keys', async () => {
      const redisClientMock = {
        del: vi.fn().mockResolvedValue(1),
      };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { invalidateCachedSupabaseProfileAll } = await import('../../src/lib/profileCache.js');
      await invalidateCachedSupabaseProfileAll('user-123');

      expect(redisClientMock.del).toHaveBeenCalledTimes(3);
      expect(redisClientMock.del).toHaveBeenCalledWith('user:profile:sb:user-123');
      expect(redisClientMock.del).toHaveBeenCalledWith('user:profile:sb:user-123:stats');
      expect(redisClientMock.del).toHaveBeenCalledWith('user:profile:sb:user-123:driver');
    });

    it('does not throw if redisClient is not defined', async () => {
      vi.doMock('../../src/config/db.js', () => ({ redisClient: null }));
      const { invalidateCachedSupabaseProfileAll } = await import('../../src/lib/profileCache.js');
      await expect(invalidateCachedSupabaseProfileAll('user-123')).resolves.toBeUndefined();
    });

    it('does not throw if userId is missing', async () => {
      const redisClientMock = { del: vi.fn() };
      vi.doMock('../../src/config/db.js', () => ({ redisClient: redisClientMock }));

      const { invalidateCachedSupabaseProfileAll } = await import('../../src/lib/profileCache.js');
      await invalidateCachedSupabaseProfileAll(null);
      expect(redisClientMock.del).not.toHaveBeenCalled();
    });
  });

  describe('isValidCachedProfile', () => {
    beforeEach(() => {
      vi.doMock('../../src/config/db.js', () => ({ redisClient: null }));
    });

    it('returns false for invalid inputs (null, array, string, non-object)', async () => {
      const { isValidCachedProfile } = await import('../../src/lib/profileCache.js');
      expect(isValidCachedProfile('uid123', null)).toBe(false);
      expect(isValidCachedProfile('uid123', undefined)).toBe(false);
      expect(isValidCachedProfile('uid123', [])).toBe(false);
      expect(isValidCachedProfile('uid123', 'string')).toBe(false);
      expect(isValidCachedProfile('uid123', 123)).toBe(false);
    });

    it('returns false if isActive is missing or not a boolean', async () => {
      const { isValidCachedProfile } = await import('../../src/lib/profileCache.js');
      expect(isValidCachedProfile('uid123', { uid: 'uid123', id: 'id123', role: 'driver' })).toBe(false);
      expect(isValidCachedProfile('uid123', { isActive: 'true', uid: 'uid123', id: 'id123', role: 'driver' })).toBe(false);
    });

    it('returns true for a valid tombstone (isActive === false)', async () => {
      const { isValidCachedProfile } = await import('../../src/lib/profileCache.js');
      expect(isValidCachedProfile('uid123', { isActive: false })).toBe(true);
    });

    it('returns true for a valid active profile', async () => {
      const { isValidCachedProfile } = await import('../../src/lib/profileCache.js');
      const validProfile = {
        id: 'user-id-123',
        uid: 'uid123',
        role: 'driver',
        isActive: true
      };
      expect(isValidCachedProfile('uid123', validProfile)).toBe(true);
    });

    it('returns false for active profile with non-matching uid or invalid types', async () => {
      const { isValidCachedProfile } = await import('../../src/lib/profileCache.js');
      const badUid = { id: 'user-id-123', uid: 'different-uid', role: 'driver', isActive: true };
      const badId = { id: 123, uid: 'uid123', role: 'driver', isActive: true };
      const badRole = { id: 'user-id-123', uid: 'uid123', role: null, isActive: true };

      expect(isValidCachedProfile('uid123', badUid)).toBe(false);
      expect(isValidCachedProfile('uid123', badId)).toBe(false);
      expect(isValidCachedProfile('uid123', badRole)).toBe(false);
    });

    it('returns true for active profile with valid optional fullName and phone', async () => {
      const { isValidCachedProfile } = await import('../../src/lib/profileCache.js');
      const validProfile1 = {
        id: 'user-id-123',
        uid: 'uid123',
        role: 'driver',
        isActive: true,
        fullName: 'Bob Smith',
        phone: '+123456789'
      };
      const validProfile2 = {
        id: 'user-id-123',
        uid: 'uid123',
        role: 'driver',
        isActive: true,
        fullName: null,
        phone: undefined
      };
      expect(isValidCachedProfile('uid123', validProfile1)).toBe(true);
      expect(isValidCachedProfile('uid123', validProfile2)).toBe(true);
    });

    it('returns false for active profile with invalid type for fullName or phone', async () => {
      const { isValidCachedProfile } = await import('../../src/lib/profileCache.js');
      const badFullName = {
        id: 'user-id-123',
        uid: 'uid123',
        role: 'driver',
        isActive: true,
        fullName: 123,
        phone: '+123456789'
      };
      const badPhone = {
        id: 'user-id-123',
        uid: 'uid123',
        role: 'driver',
        isActive: true,
        fullName: 'Bob Smith',
        phone: {}
      };
      expect(isValidCachedProfile('uid123', badFullName)).toBe(false);
      expect(isValidCachedProfile('uid123', badPhone)).toBe(false);
    });
  });
});
