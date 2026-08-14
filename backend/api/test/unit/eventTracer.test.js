import { describe, it, expect, vi } from 'vitest';

describe('EventTracer', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/core/telemetry/EventTracer.js');
    expect(mod).toBeDefined();
  });
});
