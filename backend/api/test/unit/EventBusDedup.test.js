import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: {},
  STANDARD_ATTRIBUTES: {},
}));
vi.mock('../../src/core/telemetry/ContextPropagator.js', () => ({
  ContextPropagator: {},
}));

const { EventBus } = await import('../../src/core/events/EventBus.js');
const event = (eventId) => ({ metadata: { eventId } });

describe('EventBus deduplication', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    clearInterval(bus._deduplicationCleanupTimer);
    vi.restoreAllMocks();
  });

  it('rejects a duplicate within the window and accepts it after expiry', () => {
    expect(bus._isDuplicate(event('order-1'))).toBe(false);
    expect(bus._isDuplicate(event('order-1'))).toBe(true);

    bus._deduplication.set('order-1', performance.now() - 60_001);
    expect(bus._isDuplicate(event('order-1'))).toBe(false);
    expect(bus._deduplication.size).toBe(1);
  });

  it('keeps at most 10,000 recent IDs during a burst', () => {
    for (let index = 0; index < 10_001; index++) {
      expect(bus._isDuplicate(event(`order-${index}`))).toBe(false);
    }

    expect(bus._deduplication.size).toBe(10_000);
    expect(bus._deduplication.has('order-0')).toBe(false);
    expect(bus._isDuplicate(event('order-10000'))).toBe(true);
  });

  it('uses elapsed monotonic time even when the wall clock changes', () => {
    expect(bus._isDuplicate(event('order-1'))).toBe(false);
    const wallClock = vi.spyOn(Date, 'now');
    wallClock.mockReturnValue(0);
    expect(bus._isDuplicate(event('order-1'))).toBe(true);
    wallClock.mockReturnValue(Number.MAX_SAFE_INTEGER);
    expect(bus._isDuplicate(event('order-1'))).toBe(true);
  });

  it('removes expired IDs while idle', async () => {
    bus._deduplicationWindowMs = 15;
    expect(bus._isDuplicate(event('order-1'))).toBe(false);

    await vi.waitFor(() => expect(bus._deduplication.size).toBe(0), {
      timeout: 500,
    });
  });
});
