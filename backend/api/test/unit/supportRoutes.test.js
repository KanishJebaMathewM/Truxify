import { describe, it, expect, vi } from 'vitest';

describe('supportRoutes', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/routes/supportRoutes.js');
    expect(mod).toBeDefined();
  });
});
