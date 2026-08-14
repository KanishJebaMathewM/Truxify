import { describe, it, expect, vi } from 'vitest';

describe('authRoutes', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/routes/authRoutes.js');
    expect(mod).toBeDefined();
  });
});
