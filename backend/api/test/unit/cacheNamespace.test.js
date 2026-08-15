import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheNamespace } from '../../src/cache/CacheNamespace.js';

describe('CacheNamespace', () => {
  describe('register and get', () => {
    it('registers and retrieves a namespace', () => {
      CacheNamespace.register('test_ns', { defaultTtl: 300 });
      const ns = CacheNamespace.get('test_ns');
      expect(ns).toBeDefined();
      expect(ns.defaultTtl).toBe(300);
    });
  });
});
