import { describe, it, expect } from 'vitest';
import { CacheNamespace } from '../../../src/cache/CacheNamespace.js';

// Use a unique namespace per test group so the built-in registrations and
// other groups are never clobbered.
describe('CacheNamespace registry', () => {
  it('register creates an entry with default values', () => {
    const entry = CacheNamespace.register('zz-test-defaults');
    expect(entry).toEqual({
      name: 'zz-test-defaults',
      prefix: 'zz-test-defaults',
      defaultTtl: 900,
      enablePubSub: true,
    });
  });

  it('register honours custom prefix, defaultTtl, and enablePubSub', () => {
    const entry = CacheNamespace.register('zz-test-custom', {
      prefix: 'zz:custom',
      defaultTtl: 60,
      enablePubSub: false,
    });
    expect(entry).toEqual({
      name: 'zz-test-custom',
      prefix: 'zz:custom',
      defaultTtl: 60,
      enablePubSub: false,
    });
  });

  it('register returns the existing entry when a name is re-registered', () => {
    const first = CacheNamespace.register('zz-test-dupe', { prefix: 'zz:one' });
    const second = CacheNamespace.register('zz-test-dupe', { prefix: 'zz:two' });
    expect(second).toBe(first);
    expect(second.prefix).toBe('zz:one');
  });

  it('get returns the registered entry or undefined', () => {
    CacheNamespace.register('zz-test-get');
    expect(CacheNamespace.get('zz-test-get')).toBeDefined();
    expect(CacheNamespace.get('zz-test-missing')).toBeUndefined();
  });

  it('isValid reflects registration state', () => {
    CacheNamespace.register('zz-test-valid');
    expect(CacheNamespace.isValid('zz-test-valid')).toBe(true);
    expect(CacheNamespace.isValid('zz-test-not-registered')).toBe(false);
  });

  it('names returns all registered namespace names including the registered one', () => {
    CacheNamespace.register('zz-test-names');
    expect(CacheNamespace.names()).toContain('zz-test-names');
  });

  it('all returns a Map containing registered entries', () => {
    CacheNamespace.register('zz-test-all');
    const all = CacheNamespace.all();
    expect(all).toBeInstanceOf(Map);
    expect(all.get('zz-test-all')).toBeDefined();
  });

  it('clear resets the registry to empty', () => {
    CacheNamespace.register('zz-test-clear');
    CacheNamespace.clear();
    expect(CacheNamespace.isValid('zz-test-clear')).toBe(false);
    expect(CacheNamespace.names()).toEqual([]);
  });
});
