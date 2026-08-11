import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

import {
  setInstanceId,
  getInstanceId,
  isInitialized,
  publishInvalidation,
  closeCachePublisher,
} from '../../src/cache/CachePublisher.js';

describe('CachePublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeCachePublisher();
    setInstanceId('test-instance');
  });

  describe('setInstanceId / getInstanceId', () => {
    it('round-trips the instance id', () => {
      setInstanceId('instance-1');
      expect(getInstanceId()).toBe('instance-1');
    });
  });

  describe('isInitialized', () => {
    it('is false before initialization', () => {
      expect(isInitialized()).toBe(false);
    });
  });

  describe('publishInvalidation', () => {
    it('is a no-op when no publish client is set', async () => {
      await expect(publishInvalidation('profile', { type: 'INVALIDATE_KEY', key: 'x' })).resolves.toBeUndefined();
    });

    it('is a no-op for an unknown namespace', async () => {
      await expect(publishInvalidation('does-not-exist', { key: 'x' })).resolves.toBeUndefined();
    });
  });
});
