import { describe, it, expect, vi } from 'vitest';

describe('QueueTracer', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/core/telemetry/QueueTracer.js');
    expect(mod).toBeDefined();
  });
});
