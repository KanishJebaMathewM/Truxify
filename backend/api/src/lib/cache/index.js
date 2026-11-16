import { MultiTierCache } from './MultiTierCache.js';
import { shouldRecompute, getRemainingTtl } from './XFetch.js';
import { StampedeLock } from './StampedeLock.js';
import { CacheMetrics } from './CacheMetrics.js';

// Default global instance for common freight cache workflows
export const defaultMultiTierCache = new MultiTierCache();

export {
  MultiTierCache,
  shouldRecompute,
  getRemainingTtl,
  StampedeLock,
  CacheMetrics,
};

export default defaultMultiTierCache;
