import { describe, it, expect, vi } from 'vitest';

describe('crossDockRoutes', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/routes/crossDockRoutes.js');
    expect(mod).toBeDefined();
  });
});
