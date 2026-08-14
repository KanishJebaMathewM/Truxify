import { describe, it, expect, vi } from 'vitest';

describe('documentRoutes', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/routes/documentRoutes.js');
    expect(mod).toBeDefined();
  });
});
