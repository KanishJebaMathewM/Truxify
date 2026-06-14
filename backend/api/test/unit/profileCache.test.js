import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('profileCache utility', () => {
  beforeEach(() => {
    vi.resetModules();
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

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { getCachedProfile } = await import('../../src/lib/profileCache.js');
      try {
        const profile = await getCachedProfile('firebase-123');
        expect(profile).toBeNull();
        expect(consoleSpy).toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it('returns null and logs error if redis get throws', async () => {
      const redisClientMock = {
        get: vi.fn().mockRejectedValue(new Error('Redis connection failure')),
      };
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: redisClientMock,
      }));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { getCachedProfile } = await import('../../src/lib/profileCache.js');
      try {
        const profile = await getCachedProfile('firebase-123');
        expect(profile).toBeNull();
        expect(consoleSpy).toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe('setCachedProfile', () => {
    it('does not write and does not throw if redisClient is not defined', async () => {
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: null,
      }));

      const { setCachedProfile } = await import('../../src/lib/profileCache.js');
      await expect(setCachedProfile('firebase-123', { id: '123' })).resolves.not.toThrow();
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

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { setCachedProfile } = await import('../../src/lib/profileCache.js');
      try {
        await setCachedProfile('firebase-123', { id: '123' });
        expect(consoleSpy).toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe('invalidateCachedProfile', () => {
    it('does not call and does not throw if redisClient is not defined', async () => {
      vi.doMock('../../src/config/db.js', () => ({
        redisClient: null,
      }));

      const { invalidateCachedProfile } = await import('../../src/lib/profileCache.js');
      await expect(invalidateCachedProfile('firebase-123')).resolves.not.toThrow();
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

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { invalidateCachedProfile } = await import('../../src/lib/profileCache.js');
      try {
        await invalidateCachedProfile('firebase-123');
        expect(consoleSpy).toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });
});
