import { describe, it, expect, vi } from 'vitest';

describe('HealthAggregator', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/core/health/HealthAggregator.js');
    expect(mod).toBeDefined();
  });
});
