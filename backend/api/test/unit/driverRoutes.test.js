import { describe, it, expect, vi } from 'vitest';

describe('driverRoutes', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/routes/driverRoutes.js');
    expect(mod).toBeDefined();
  });
});
