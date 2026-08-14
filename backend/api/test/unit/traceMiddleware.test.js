import { describe, it, expect, vi } from 'vitest';

describe('TraceMiddleware', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/core/telemetry/TraceMiddleware.js');
    expect(mod).toBeDefined();
  });
});
