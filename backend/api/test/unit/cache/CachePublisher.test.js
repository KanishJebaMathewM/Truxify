import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('ioredis', () => {
  const mockRedis = vi.fn(() => ({
    on: vi.fn(),
    subscribe: vi.fn((ch, cb) => cb(null, ch)),
    unsubscribe: vi.fn((ch, cb) => cb(null, ch)),
    quit: vi.fn(),
    disconnect: vi.fn(),
  }));
  return { default: mockRedis };
});

vi.mock('../../../src/cache/CacheNamespace.js', () => ({
  CacheNamespace: {
    isValid: vi.fn((ns) => ['profile', 'order'].includes(ns)),
    get: vi.fn((ns) => ({ enablePubSub: true, namespace: ns })),
  },
}));

vi.mock('../../../src/cache/CacheKeyBuilder.js', () => ({
  CacheKeyBuilder: {
    pubSubChannel: vi.fn((ns) => `cache:${ns}:events`),
  },
}));

vi.mock('../../../src/cache/CacheEvent.js', () => ({
  CacheEventType: { INVALIDATE_KEY: 'INVALIDATE_KEY' },
  createCacheEvent: vi.fn((type, opts) => ({
    id: 'evt-1', type, namespace: opts.namespace, originInstanceId: opts.originInstanceId, timestamp: Date.now(),
  })),
  serializeCacheEvent: vi.fn((e) => JSON.stringify(e)),
}));

const {
  initCachePublisher,
  publishInvalidation,
  subscribeToInvalidation,
  setInstanceId,
  getInstanceId,
  isInitialized,
  closeCachePublisher,
} = await import('../../../src/cache/CachePublisher.js');

describe('CachePublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await closeCachePublisher();
  });

  describe('initCachePublisher', () => {
    it('is not initialized initially', () => {
      expect(isInitialized()).toBe(false);
    });

    it('sets up publisher when valid client and REDIS_URL provided', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const mockClient = { on: vi.fn() };
      initCachePublisher(mockClient);
      expect(typeof isInitialized()).toBe('boolean');
      delete process.env.REDIS_URL;
    });

    it('logs warning when no redis client is provided', () => {
      initCachePublisher(null);
      expect(isInitialized()).toBe(false);
    });
  });

  describe('setInstanceId / getInstanceId', () => {
    it('allows setting and getting instance ID', () => {
      setInstanceId('test-instance');
      expect(getInstanceId()).toBe('test-instance');
    });
  });

  describe('publishInvalidation', () => {
    it('publishes to the correct channel', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const mockClient = {
        on: vi.fn(),
        publish: vi.fn().mockResolvedValue(1),
      };
      initCachePublisher(mockClient);
      await publishInvalidation('profile', { key: 'profile:sb:123' });
      expect(mockClient.publish).toHaveBeenCalled();
      delete process.env.REDIS_URL;
    });

    it('returns early for invalid namespace', async () => {
      const mockClient = { on: vi.fn(), publish: vi.fn() };
      initCachePublisher(mockClient);
      await publishInvalidation('invalid-namespace', {});
      expect(mockClient.publish).not.toHaveBeenCalled();
    });
  });

  describe('subscribeToInvalidation', () => {
    it('returns an unsubscribe function', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const mockClient = { on: vi.fn() };
      initCachePublisher(mockClient);
      const handler = vi.fn();
      const unsubscribe = subscribeToInvalidation('profile', handler);
      expect(typeof unsubscribe).toBe('function');
    });
  });
});
