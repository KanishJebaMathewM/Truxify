import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

import { CacheNamespace } from '../../src/cache/CacheNamespace.js';

function registerBuiltins() {
  CacheNamespace.register('profile', {
    defaultTtl: parseInt(process.env.REDIS_CACHE_TTL || '900', 10),
  });
  CacheNamespace.register('order', { defaultTtl: 300 });
  CacheNamespace.register('driver', { defaultTtl: 300 });
  CacheNamespace.register('lookup', { defaultTtl: 3600 });
  CacheNamespace.register('osrm', { defaultTtl: 86400 });
  CacheNamespace.register('fraud', { defaultTtl: 3600 });
  CacheNamespace.register('idempotency', { defaultTtl: 3600 });
  CacheNamespace.register('shard', { defaultTtl: 300 });
  CacheNamespace.register('rate_limit', { defaultTtl: 900, enablePubSub: false });
  CacheNamespace.register('lock', { defaultTtl: 10, enablePubSub: false });
  CacheNamespace.register('tracker', { defaultTtl: 86400 });
  CacheNamespace.register('load_offer', { defaultTtl: 120 });
  CacheNamespace.register('otp', { defaultTtl: 3600, enablePubSub: false });
  CacheNamespace.register('version', { defaultTtl: 0, enablePubSub: false });
}

describe('CacheNamespace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('registers a new namespace and returns its entry', () => {
      CacheNamespace.clear();
      const entry = CacheNamespace.register('custom_ns', { defaultTtl: 60 });
      expect(entry).toEqual({
        name: 'custom_ns',
        prefix: 'custom_ns',
        defaultTtl: 60,
        enablePubSub: true,
      });
    });

    it('returns existing entry on duplicate registration', () => {
      CacheNamespace.clear();
      const first = CacheNamespace.register('dup', { defaultTtl: 100 });
      const second = CacheNamespace.register('dup', { defaultTtl: 200 });
      expect(second).toBe(first);
      expect(second.defaultTtl).toBe(100);
    });

    it('uses custom prefix when provided', () => {
      CacheNamespace.clear();
      const entry = CacheNamespace.register('prefixed', { prefix: 'pfx' });
      expect(entry.prefix).toBe('pfx');
    });

    it('defaults enablePubSub to true', () => {
      CacheNamespace.clear();
      const entry = CacheNamespace.register('pubsub_default');
      expect(entry.enablePubSub).toBe(true);
    });

    it('sets enablePubSub to false when explicitly disabled', () => {
      CacheNamespace.clear();
      const entry = CacheNamespace.register('no_pubsub', { enablePubSub: false });
      expect(entry.enablePubSub).toBe(false);
    });

    it('defaults defaultTtl to 900 when not provided', () => {
      CacheNamespace.clear();
      const entry = CacheNamespace.register('ttl_default');
      expect(entry.defaultTtl).toBe(900);
    });
  });

  describe('get', () => {
    it('retrieves a registered namespace', () => {
      CacheNamespace.clear();
      CacheNamespace.register('find_me', { defaultTtl: 42 });
      const entry = CacheNamespace.get('find_me');
      expect(entry.name).toBe('find_me');
      expect(entry.defaultTtl).toBe(42);
    });

    it('returns undefined for an unregistered namespace', () => {
      expect(CacheNamespace.get('nonexistent')).toBeUndefined();
    });
  });

  describe('isValid', () => {
    it('returns true for a registered namespace', () => {
      CacheNamespace.clear();
      CacheNamespace.register('valid_ns');
      expect(CacheNamespace.isValid('valid_ns')).toBe(true);
    });

    it('returns false for an unregistered namespace', () => {
      expect(CacheNamespace.isValid('invalid_ns')).toBe(false);
    });
  });

  describe('names', () => {
    it('returns all registered namespace names', () => {
      CacheNamespace.clear();
      CacheNamespace.register('alpha');
      CacheNamespace.register('beta');
      CacheNamespace.register('gamma');
      const result = CacheNamespace.names();
      expect(result).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
      expect(result).toHaveLength(3);
    });

    it('returns an empty array when no namespaces are registered', () => {
      CacheNamespace.clear();
      expect(CacheNamespace.names()).toEqual([]);
    });
  });

  describe('all', () => {
    it('returns a Map of all registered entries', () => {
      CacheNamespace.clear();
      CacheNamespace.register('x');
      CacheNamespace.register('y');
      const result = CacheNamespace.all();
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.has('x')).toBe(true);
      expect(result.has('y')).toBe(true);
    });

    it('returns a copy, not the internal map', () => {
      CacheNamespace.clear();
      CacheNamespace.register('z');
      const result = CacheNamespace.all();
      result.delete('z');
      expect(CacheNamespace.isValid('z')).toBe(true);
    });
  });

  describe('clear', () => {
    it('removes all registered namespaces', () => {
      CacheNamespace.register('to_clear_1');
      CacheNamespace.register('to_clear_2');
      CacheNamespace.clear();
      expect(CacheNamespace.names()).toEqual([]);
    });
  });

  describe('default TTL and prefix', () => {
    it('prefix defaults to name when not specified', () => {
      CacheNamespace.clear();
      const entry = CacheNamespace.register('my_namespace');
      expect(entry.prefix).toBe('my_namespace');
    });

    it('defaultTtl defaults to 900 when not provided', () => {
      CacheNamespace.clear();
      const entry = CacheNamespace.register('ttl_test');
      expect(entry.defaultTtl).toBe(900);
    });

    it('enablePubSub defaults to true when not specified', () => {
      CacheNamespace.clear();
      const entry = CacheNamespace.register('pubsub_test');
      expect(entry.enablePubSub).toBe(true);
    });
  });
});

describe('CacheNamespace — built-in namespaces', () => {
  beforeAll(() => {
    CacheNamespace.clear();
    registerBuiltins();
  });

  it('all expected built-in names are present', () => {
    const expected = [
      'profile', 'order', 'driver', 'lookup', 'osrm', 'fraud',
      'idempotency', 'shard', 'rate_limit', 'lock', 'tracker',
      'load_offer', 'otp', 'version',
    ];
    for (const name of expected) {
      expect(CacheNamespace.isValid(name)).toBe(true);
    }
  });

  it('registers profile namespace', () => {
    const entry = CacheNamespace.get('profile');
    expect(entry).toBeDefined();
    expect(entry.name).toBe('profile');
    expect(entry.prefix).toBe('profile');
  });

  it('registers order namespace with 300 TTL', () => {
    const entry = CacheNamespace.get('order');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(300);
  });

  it('registers driver namespace with 300 TTL', () => {
    const entry = CacheNamespace.get('driver');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(300);
  });

  it('registers lookup namespace with 3600 TTL', () => {
    const entry = CacheNamespace.get('lookup');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(3600);
  });

  it('registers osrm namespace with 86400 TTL', () => {
    const entry = CacheNamespace.get('osrm');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(86400);
  });

  it('registers fraud namespace with 3600 TTL', () => {
    const entry = CacheNamespace.get('fraud');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(3600);
  });

  it('registers idempotency namespace with 3600 TTL', () => {
    const entry = CacheNamespace.get('idempotency');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(3600);
  });

  it('registers shard namespace with 300 TTL', () => {
    const entry = CacheNamespace.get('shard');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(300);
  });

  it('registers rate_limit namespace with enablePubSub false', () => {
    const entry = CacheNamespace.get('rate_limit');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(900);
    expect(entry.enablePubSub).toBe(false);
  });

  it('registers lock namespace with 10s TTL and no pubsub', () => {
    const entry = CacheNamespace.get('lock');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(10);
    expect(entry.enablePubSub).toBe(false);
  });

  it('registers tracker namespace with 86400 TTL', () => {
    const entry = CacheNamespace.get('tracker');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(86400);
  });

  it('registers load_offer namespace with 120 TTL', () => {
    const entry = CacheNamespace.get('load_offer');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(120);
  });

  it('registers otp namespace with 3600 TTL and no pubsub', () => {
    const entry = CacheNamespace.get('otp');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(3600);
    expect(entry.enablePubSub).toBe(false);
  });

  it('registers version namespace with 0 TTL and no pubsub', () => {
    const entry = CacheNamespace.get('version');
    expect(entry).toBeDefined();
    expect(entry.defaultTtl).toBe(0);
    expect(entry.enablePubSub).toBe(false);
  });
});
