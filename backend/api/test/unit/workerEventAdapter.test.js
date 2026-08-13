import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('WorkerEventAdapter', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('can be imported', async () => {
    const mod = await import('../../src/core/events/adapters/WorkerEventAdapter.js');
    expect(mod.WorkerEventAdapter).toBeDefined();
  });
});
