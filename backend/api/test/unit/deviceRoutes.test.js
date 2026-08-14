import { describe, it, expect, vi } from 'vitest';

describe('deviceRoutes', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/routes/deviceRoutes.js');
    expect(mod).toBeDefined();
  });
});
