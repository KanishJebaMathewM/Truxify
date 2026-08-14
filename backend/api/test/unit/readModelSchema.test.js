import { describe, it, expect } from 'vitest';

describe('read-model-schema', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/core/orders/read-model-schema.js');
    expect(mod).toBeDefined();
  });
});
