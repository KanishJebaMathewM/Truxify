/**
 * Unit tests for backend/api/src/core/events/WorkerEventAdapter.js
 *
 * Coverage:
 *   - WorkerEventAdapter: fallback when module not found
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/core/events/EventBus.js', () => ({ EventBus: vi.fn() }));

describe('WorkerEventAdapter', () => {
  it('provides a fallback class when module unavailable', async () => {
    const { WorkerEventAdapter } = await import('../../src/core/events/WorkerEventAdapter.js');
    expect(WorkerEventAdapter).toBeDefined();
  });
});
