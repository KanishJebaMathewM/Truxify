/**
 * Centralized cache namespace registry.
 *
 * Every cached domain entity MUST be registered here. Namespaces
 * isolate cache keys so that pattern-based invalidation (e.g. SCAN)
 * can target a specific domain without collateral damage.
 *
 * Usage:
 *   import { CacheNamespace } from './CacheNamespace.js';
 *   CacheNamespace.register('profile', { defaultTtl: 900 });
 *   CacheNamespace.isValid('profile'); // true
 */

const namespaces = new Map();

export const CacheNamespace = {
  /**
   * Register a new cache namespace.
   *
   * @param {string} name — unique identifier (e.g. 'profile', 'order', 'rate_limit')
   * @param {object} opts
   * @param {number} [opts.defaultTtl] — default TTL in seconds for this namespace
   * @param {string} [opts.prefix] — optional Redis key prefix (defaults to name)
   * @param {boolean} [opts.enablePubSub] — whether invalidation events are published (default true)
   */
  register(name, opts = {}) {
    if (namespaces.has(name)) {
      return namespaces.get(name);
    }
    const entry = {
      name,
      prefix: opts.prefix || name,
      defaultTtl: opts.defaultTtl ?? 900,
      enablePubSub: opts.enablePubSub !== false,
    };
    namespaces.set(name, entry);
    return entry;
  },

  /**
   * Retrieve a registered namespace entry.
   * @param {string} name
   * @returns {object|undefined}
   */
  get(name) {
    return namespaces.get(name);
  },

  /**
   * Check whether a namespace has been registered.
   * @param {string} name
   * @returns {boolean}
   */
  isValid(name) {
    return namespaces.has(name);
  },

  /**
   * Return all registered namespace names.
   * @returns {string[]}
   */
  names() {
    return [...namespaces.keys()];
  },

  /**
   * Return all registered entries.
   * @returns {Map<string, object>}
   */
  all() {
    return new Map(namespaces);
  },

  /**
   * Clear all registrations. Intended for test isolation only.
   */
  clear() {
    namespaces.clear();
  },
};

// ── Built-in namespaces ─────────────────────────────────────────────
CacheNamespace.register('profile', {
  prefix: 'user:profile',
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

export default CacheNamespace;
