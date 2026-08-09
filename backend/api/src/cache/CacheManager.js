import { CacheNamespace } from './CacheNamespace.js';
import { CacheKeyBuilder } from './CacheKeyBuilder.js';
import {
  initCachePublisher,
  publishInvalidation as _publishInvalidation,
  subscribeToInvalidation as _subscribeToInvalidation,
} from './CachePublisher.js';
import {
  initCacheInvalidator,
  invalidateKey as _invalidateKey,
  bumpVersion as _bumpVersion,
  getStats as _getInvalidatorStats,
} from './CacheInvalidator.js';
import logger from '../middleware/logger.js';

let redisClient = null;
let initialized = false;

const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
  errors: 0,
};

export function init(client) {
  if (initialized) return;
  redisClient = client;
  CacheKeyBuilder._setRedisClient(client);
  if (!client) {
    logger.warn('[CacheManager] No Redis client provided - caching disabled.');
    return;
  }
  initCachePublisher(client);
  initCacheInvalidator(client);
  initialized = true;
  logger.info('[CacheManager] Initialized.');
}

export async function get(namespace, entityId, subKey) {
  if (!redisClient) return null;
  const key = CacheKeyBuilder.build(namespace, entityId, subKey);
  try {
    const raw = await redisClient.get(key);
    if (raw) {
      stats.hits++;
      return JSON.parse(raw);
    }
    stats.misses++;
    return null;
  } catch (err) {
    stats.errors++;
    logger.error({ err, key }, '[CacheManager] GET error');
    return null;
  }
}

export async function set(namespace, entityId, value, opts = {}) {
  if (!redisClient || !entityId || value === undefined || value === null) return false;
  const key = CacheKeyBuilder.build(namespace, entityId, opts.subKey);
  const ns = CacheNamespace.get(namespace);
  const ttl = opts.ttl ?? ns?.defaultTtl ?? 900;
  try {
    const serialized = JSON.stringify(value);
    if (ttl > 0) {
      await redisClient.set(key, serialized, 'EX', ttl);
    } else {
      await redisClient.set(key, serialized);
    }
    stats.sets++;
    return true;
  } catch (err) {
    stats.errors++;
    logger.error({ err, key }, '[CacheManager] SET error');
    return false;
  }
}

export async function invalidate(namespace, entityId, opts = {}) {
  if (!redisClient) return;
  const key = CacheKeyBuilder.build(namespace, entityId, opts.subKey);
  await _invalidateKey(namespace, key, { localOnly: opts.localOnly });
  stats.deletes++;
}

export async function invalidateBatch(namespace, entityIds, opts = {}) {
  if (!redisClient || !entityIds?.length) return;
  const keys = entityIds.map((id) => CacheKeyBuilder.build(namespace, id, opts.subKey));
  try {
    const pipeline = redisClient.pipeline();
    for (const key of keys) {
      pipeline.del(key);
    }
    await pipeline.exec();
    stats.deletes += keys.length;
    if (!opts.localOnly) {
      await _publishInvalidation(namespace, {
        type: 'INVALIDATE_PATTERN',
        pattern: CacheKeyBuilder.pattern(namespace),
      });
    }
  } catch (err) {
    stats.errors++;
    logger.error({ err, namespace }, '[CacheManager] Batch invalidation error');
  }
}

export async function invalidateAll(namespace, opts = {}) {
  if (!redisClient) return;
  const { invalidateNamespace } = await import('./CacheInvalidator.js');
  await invalidateNamespace(namespace, { localOnly: opts.localOnly });
  stats.deletes++;
}

export async function bumpVersion(namespace, entityId, subKey, opts = {}) {
  if (!redisClient) return;
  await _bumpVersion(namespace, entityId, subKey, { localOnly: opts.localOnly });
}

export async function getVersion(namespace, entityId, subKey) {
  if (!redisClient) return null;
  const key = CacheKeyBuilder.versionKey(namespace, entityId, subKey);
  try {
    const raw = await redisClient.get(key);
    return raw ? parseInt(raw, 10) : 1;
  } catch (err) {
    logger.error({ err, key }, '[CacheManager] GET version error');
    return 1;
  }
}

export function getRedisClient() {
  return redisClient;
}

export function getStats() {
  const invalidatorStats = _getInvalidatorStats();
  return {
    cache: { ...stats },
    invalidator: invalidatorStats,
    total: stats.hits + stats.misses,
    hitRate: (stats.hits + stats.misses) > 0
      ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) + '%'
      : '0%',
  };
}

export function resetStats() {
  stats.hits = 0;
  stats.misses = 0;
  stats.sets = 0;
  stats.deletes = 0;
  stats.errors = 0;
}

export function isInitialized() {
  return initialized;
}

export function shutdown() {
  redisClient = null;
  CacheKeyBuilder._setRedisClient(null);
  initialized = false;
  logger.info('[CacheManager] Shut down.');
}

export default {
  init,
  get,
  set,
  invalidate,
  invalidateBatch,
  invalidateAll,
  bumpVersion,
  getVersion,
  getRedisClient,
  getStats,
  resetStats,
  isInitialized,
  shutdown,
};
