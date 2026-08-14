import { describe, it, expect, beforeEach } from 'vitest';
import { CacheNamespace } from '../../../src/cache/CacheNamespace.js';

describe('CacheNamespace', () => {
  beforeEach(() => {
    CacheNamespace.clear();
  });

  it('registers a namespace with default options', () => {
    const entry = CacheNamespace.register('my_ns');
    expect(entry).toEqual({
      name: 'my_ns',
      prefix: 'my_ns',
      defaultTtl: 900,
      enablePubSub: true,
    });
  });

  it('registers a namespace with custom options', () => {
    const entry = CacheNamespace.register('orders', {
      prefix: 'ord',
      defaultTtl: 60,
      enablePubSub: false,
    });
    expect(entry).toEqual({
      name: 'orders',
      prefix: 'ord',
      defaultTtl: 60,
      enablePubSub: false,
    });
  });

  it('returns the existing entry when re-registering the same name', () => {
    CacheNamespace.register('orders');
    const second = CacheNamespace.register('orders', { defaultTtl: 5 });
    expect(second.defaultTtl).toBe(900);
    expect(CacheNamespace.names()).toEqual(['orders']);
  });

  it('get returns undefined for unregistered names', () => {
    expect(CacheNamespace.get('missing')).toBeUndefined();
  });

  it('isValid distinguishes registered and unregistered names', () => {
    CacheNamespace.register('profile');
    expect(CacheNamespace.isValid('profile')).toBe(true);
    expect(CacheNamespace.isValid('ghost')).toBe(false);
  });

  it('names returns all registered names', () => {
    CacheNamespace.register('a');
    CacheNamespace.register('b');
    CacheNamespace.register('c');
    expect(CacheNamespace.names().sort()).toEqual(['a', 'b', 'c']);
  });

  it('all returns a fresh Map of entries', () => {
    CacheNamespace.register('a', { prefix: 'x' });
    const all = CacheNamespace.all();
    expect(all).toBeInstanceOf(Map);
    expect(all.get('a').prefix).toBe('x');
  });

  it('clear empties the registry', () => {
    CacheNamespace.register('a');
    CacheNamespace.clear();
    expect(CacheNamespace.names()).toEqual([]);
  });
});
