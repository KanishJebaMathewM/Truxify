import { expect, test, describe, beforeEach, vi, afterEach } from 'vitest';
import { LRUCache } from '../../src/utils/cache.js';

describe('LRUCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('should store and retrieve values', () => {
    const cache = new LRUCache(5);
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  test('should return undefined for missing keys', () => {
    const cache = new LRUCache(5);
    expect(cache.get('missing')).toBeUndefined();
  });

  test('should evict least recently used item when capacity is exceeded', () => {
    const cache = new LRUCache(2);
    
    cache.set('a', 1);
    cache.set('b', 2);
    
    // Cache is full (a, b)
    expect(cache.get('a')).toBe(1); // 'a' is now most recently used
    
    cache.set('c', 3); // 'b' should be evicted because 'a' was just read
    
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  test('should expire items after TTL', () => {
    const cache = new LRUCache(5, 1000); // 1 second TTL
    
    cache.set('temp', 'data');
    expect(cache.get('temp')).toBe('data');
    
    // Fast-forward time by 1.5 seconds
    vi.advanceTimersByTime(1500);
    
    expect(cache.get('temp')).toBeUndefined();
  });

  test('should support manual invalidation', () => {
    const cache = new LRUCache(5);
    cache.set('key', 'val');
    
    cache.invalidate('key');
    expect(cache.get('key')).toBeUndefined();
  });
  
  test('should clear all items', () => {
    const cache = new LRUCache(5);
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    
    cache.clear();
    
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k2')).toBeUndefined();
  });

  test('should support per-entry TTL override', () => {
    const cache = new LRUCache(5, 60000); // 60s default
    cache.set('a', 1, 500); // 500ms override
    expect(cache.get('a')).toBe(1);
    vi.advanceTimersByTime(600);
    expect(cache.get('a')).toBeUndefined();
  });

  test('should update value and refresh TTL on existing key', () => {
    const cache = new LRUCache(5, 1000);
    cache.set('k', 'v1');
    vi.advanceTimersByTime(800);
    cache.set('k', 'v2'); // should refresh TTL
    expect(cache.get('k')).toBe('v2');
    vi.advanceTimersByTime(800);
    expect(cache.get('k')).toBe('v2'); // still valid — TTL was reset
  });

  test('should throw on invalid capacity', () => {
    expect(() => new LRUCache(0)).toThrow();
    expect(() => new LRUCache(-1)).toThrow();
  });
});
