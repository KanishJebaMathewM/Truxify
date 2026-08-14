import { describe, it, expect, vi } from 'vitest';

describe('HealthCheck', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/core/health/HealthCheck.js');
    expect(mod).toBeDefined();
  });
});
