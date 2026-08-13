import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setInstanceId, getInstanceId } from '../../src/cache/CachePublisher.js';

describe('CachePublisher', () => {
  describe('setInstanceId / getInstanceId', () => {
    it('allows setting and retrieving the instance ID', () => {
      setInstanceId('test-instance-1');
      expect(getInstanceId()).toBe('test-instance-1');
    });

    it('defaults to a non-empty string', () => {
      expect(getInstanceId()).toBeTruthy();
    });
  });

  describe('module exports', () => {
    it('exports expected functions', async () => {
      const mod = await import('../../src/cache/CachePublisher.js');
      expect(typeof mod.setInstanceId).toBe('function');
      expect(typeof mod.getInstanceId).toBe('function');
      expect(typeof mod.initCachePublisher).toBe('function');
      expect(typeof mod.publishInvalidation).toBe('function');
      expect(typeof mod.subscribeToInvalidation).toBe('function');
      expect(typeof mod.isInitialized).toBe('function');
      expect(typeof mod.closeCachePublisher).toBe('function');
    });
  });
});
