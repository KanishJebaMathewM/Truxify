import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCacheStats,
  resetCacheStats,
} from '../../lib/profileCache.js';

describe('profileCache stats', () => {
  beforeEach(() => {
    resetCacheStats();
  });

  it('returns zero stats on fresh reset', () => {
    const stats = getCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.sets).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.hitRate).toBe('0%');
  });

  it('hit rate is 0% when no requests made', () => {
    const stats = getCacheStats();
    expect(stats.hitRate).toBe('0%');
  });
});
