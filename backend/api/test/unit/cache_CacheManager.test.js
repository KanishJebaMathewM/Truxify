/**
 * Unit tests for backend/api/src/cache/CacheManager.js
 *
 * Coverage:
 *   - constructor: initializes with namespace
 *   - set: stores value with TTL
 *   - set: stores value without TTL
 *   - get: retrieves stored value
 *   - get: returns null for missing key
 *   - invalidate: removes key from store
 *   - getStats: returns cache statistics
 *   - clear: removes all entries
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheManager } from '../../src/cache/CacheManager.js';

describe('CacheManager', () => {
  let manager;
  let mockNs;

  beforeEach(() => {
    mockNs = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn() };
    manager = new CacheManager(mockNs);
  });

  describe('constructor', () => {
    it('initializes with provided namespace', () => {
      expect(manager.namespace).toBe(mockNs);
    });
  });

  describe('set', () => {
    it('stores value with TTL', async () => {
      await manager.set('key:123', { data: 'value' }, 60000);
      expect(mockNs.set).toHaveBeenCalledWith('key:123', expect.anything(), 60000);
    });

    it('stores value without TTL', async () => {
      await manager.set('key:456', { data: 'val' });
      expect(mockNs.set).toHaveBeenCalledWith('key:456', expect.anything(), undefined);
    });
  });

  describe('get', () => {
    it('retrieves stored value', async () => {
      mockNs.get.mockResolvedValue({ data: 'test' });
      expect(await manager.get('key:789')).toEqual({ data: 'test' });
    });

    it('returns null for missing key', async () => {
      mockNs.get.mockResolvedValue(null);
      expect(await manager.get('missing:key')).toBeNull();
    });
  });

  describe('invalidate', () => {
    it('removes key from store', async () => {
      mockNs.delete.mockResolvedValue(true);
      await manager.invalidate('key:123');
      expect(mockNs.delete).toHaveBeenCalledWith('key:123');
    });
  });

  describe('getStats', () => {
    it('returns stats object', async () => {
      expect(typeof await manager.getStats()).toBe('object');
    });
  });

  describe('clear', () => {
    it('clears all entries', async () => {
      await manager.clear();
      expect(mockNs.clear).toHaveBeenCalled();
    });
  });
});
