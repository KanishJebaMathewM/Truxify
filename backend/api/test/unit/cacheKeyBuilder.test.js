import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Mock CacheNamespace
vi.mock('../../src/cache/CacheNamespace.js', () => ({
  CacheNamespace: {
    get: vi.fn((name) => {
      const builtins = {
        profile: { name: 'profile', prefix: 'user:profile', defaultTtl: 900 },
        order: { name: 'order', prefix: 'order', defaultTtl: 300 },
      };
      return builtins[name] || null;
    }),
    // CacheKeyBuilder.parse matches the longest registered prefix.
    all: vi.fn(() => [
      { name: 'profile', prefix: 'user:profile', defaultTtl: 900 },
      { name: 'order', prefix: 'order', defaultTtl: 300 },
    ]),
  },
  default: {
    get: vi.fn(),
  },
}));

describe('CacheKeyBuilder', () => {
  let CacheKeyBuilder;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('../../src/cache/CacheKeyBuilder.js');
    CacheKeyBuilder = mod.CacheKeyBuilder;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── build ────────────────────────────────────────────────────────────────

  describe('build', () => {
    it('creates correct key format with namespace and entityId', () => {
      const key = CacheKeyBuilder.build('profile', 'sb:abc123');
      expect(key).toBe('user:profile:sb:abc123');
    });

    it('creates correct key format with subKey', () => {
      const key = CacheKeyBuilder.build('profile', 'sb:abc123', 'stats');
      expect(key).toBe('user:profile:sb:abc123:stats');
    });

    it('uses namespace name as prefix when namespace is not registered', () => {
      const key = CacheKeyBuilder.build('unknown', 'entity-1');
      expect(key).toBe('unknown:entity-1');
    });

    it('namespace isolation works via different prefixes', () => {
      const profileKey = CacheKeyBuilder.build('profile', 'sb:123');
      const orderKey = CacheKeyBuilder.build('order', 'sb:123');
      expect(profileKey).not.toBe(orderKey);
      expect(profileKey).toContain('user:profile');
      expect(orderKey).toContain('order');
    });

    it('omits subKey when not provided', () => {
      const key = CacheKeyBuilder.build('profile', 'id-1');
      expect(key.split(':')).toHaveLength(3);
      expect(key).toBe('user:profile:id-1');
    });

    it('handles entityId with colon characters', () => {
      const key = CacheKeyBuilder.build('profile', 'sb:user:123');
      expect(key).toBe('user:profile:sb:user:123');
    });

    it('handles special characters in entityId', () => {
      const key = CacheKeyBuilder.build('profile', 'user@example.com');
      expect(key).toBe('user:profile:user@example.com');
    });
  });

  // ── buildVersioned ─────────────────────────────────────────────────────

  describe('buildVersioned', () => {
    it('appends version prefix to key', async () => {
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123', null, 1);
      expect(key).toBe('user:profile:v1:sb:abc123');
    });

    it('includes subKey in versioned key', async () => {
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc', 'stats', 2);
      expect(key).toBe('user:profile:v2:sb:abc:stats');
    });

    it('defaults to v1 when no version provided and no redis client', async () => {
      const key = await CacheKeyBuilder.buildVersioned('profile', 'id-1');
      expect(key).toBe('user:profile:v1:id-1');
    });

    it('accepts explicit version parameter', async () => {
      const key = await CacheKeyBuilder.buildVersioned('profile', 'id-1', null, 5);
      expect(key).toBe('user:profile:v5:id-1');
    });
  });

  // ── versionKey ──────────────────────────────────────────────────────────

  describe('versionKey', () => {
    it('returns correct version key format', () => {
      const vk = CacheKeyBuilder.versionKey('profile', 'sb:abc');
      expect(vk).toBe('user:profile:version:sb:abc');
    });

    it('includes subKey in version key when provided', () => {
      const vk = CacheKeyBuilder.versionKey('profile', 'sb:abc', 'stats');
      expect(vk).toBe('user:profile:version:sb:abc:stats');
    });
  });

  // ── pattern ────────────────────────────────────────────────────────────

  describe('pattern', () => {
    it('returns namespace wildcard pattern', () => {
      const p = CacheKeyBuilder.pattern('profile');
      expect(p).toBe('user:profile:*');
    });

    it('returns entity-specific pattern when entityId is provided', () => {
      const p = CacheKeyBuilder.pattern('profile', 'sb:abc');
      expect(p).toBe('user:profile:sb:abc*');
    });

    it('uses namespace prefix in pattern', () => {
      const p = CacheKeyBuilder.pattern('order');
      expect(p).toBe('order:*');
    });
  });

  // ── pubSubChannel ──────────────────────────────────────────────────────

  describe('pubSubChannel', () => {
    it('returns correct channel name', () => {
      const ch = CacheKeyBuilder.pubSubChannel('profile');
      expect(ch).toBe('cache:invalidate:profile');
    });

    it('returns unique channel per namespace', () => {
      const ch1 = CacheKeyBuilder.pubSubChannel('profile');
      const ch2 = CacheKeyBuilder.pubSubChannel('order');
      expect(ch1).not.toBe(ch2);
    });
  });

  // ── parse ──────────────────────────────────────────────────────────────

  describe('parse', () => {
    it('parses unversioned key correctly', () => {
      const parsed = CacheKeyBuilder.parse('user:profile:sb:abc');
      expect(parsed.namespace).toBe('user:profile');
      expect(parsed.version).toBeNull();
      expect(parsed.entityId).toBe('sb:abc');
      expect(parsed.subKey).toBeNull();
    });

    it('parses versioned key correctly', () => {
      const parsed = CacheKeyBuilder.parse('user:profile:v2:sb:abc');
      expect(parsed.namespace).toBe('user:profile');
      expect(parsed.version).toBe('v2');
      expect(parsed.entityId).toBe('sb:abc');
      expect(parsed.subKey).toBeNull();
    });

    it('parses versioned key with subKey correctly', () => {
      const parsed = CacheKeyBuilder.parse('user:profile:v3:sb:abc:stats');
      expect(parsed.namespace).toBe('user:profile');
      expect(parsed.version).toBe('v3');
      expect(parsed.entityId).toBe('sb:abc');
      expect(parsed.subKey).toBe('stats');
    });

    it('parses unversioned key with subKey correctly', () => {
      const parsed = CacheKeyBuilder.parse('user:profile:sb:abc:stats');
      expect(parsed.namespace).toBe('user:profile');
      expect(parsed.version).toBeNull();
      expect(parsed.entityId).toBe('sb:abc');
      expect(parsed.subKey).toBe('stats');
    });

    it('handles version prefix v1', () => {
      const parsed = CacheKeyBuilder.parse('order:v1:order-123');
      expect(parsed.version).toBe('v1');
      expect(parsed.entityId).toBe('order-123');
    });

    it('returns nulls for empty key', () => {
      const parsed = CacheKeyBuilder.parse('');
      expect(parsed.namespace).toBeNull();
      expect(parsed.entityId).toBeNull();
    });

    it('handles complex subKey with colons', () => {
      const parsed = CacheKeyBuilder.parse('order:v1:order-123:sub:nested');
      expect(parsed.subKey).toBe('sub:nested');
    });
  });
});
