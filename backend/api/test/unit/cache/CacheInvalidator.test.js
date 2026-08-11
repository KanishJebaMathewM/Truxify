import { describe, it, expect } from 'vitest';
import { getStats, resetStats } from '../../../src/cache/CacheInvalidator.js';

describe('CacheInvalidator', () => {
  it('resets and retrieves invalidation stats', () => {
    resetStats();
    const stats = getStats();
    expect(stats.invalidations).toBe(0);
  });
});
