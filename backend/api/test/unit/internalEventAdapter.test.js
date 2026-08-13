import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('InternalEventAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  it('can be imported', async () => {
    const mod = await import('../../src/core/events/adapters/InternalEventAdapter.js');
    expect(mod.InternalEventAdapter).toBeDefined();
  });
});
