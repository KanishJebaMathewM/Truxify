/**
 * Unit tests for backend/api/src/core/telemetry/WorkerTracer.js
 *
 * Coverage:
 *   - module can be imported
 */
import { describe, it, expect } from 'vitest';

describe('WorkerTracer', () => {
  it('module can be imported', async () => {
    const mod = await import('../../src/core/telemetry/WorkerTracer.js');
    expect(mod).toBeTruthy();
  });
});
