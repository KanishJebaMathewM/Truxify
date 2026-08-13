import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('events EventBus', () => {
  it('exports eventBus from core/events.js', async () => {
    const { eventBus } = await import('../../src/core/events.js');
    expect(eventBus).toBeDefined();
    expect(typeof eventBus.publish).toBe('function');
    expect(typeof eventBus.subscribe).toBe('function');
    expect(typeof eventBus.unsubscribe).toBe('function');
  });

  it('eventBus.subscribe returns eventBus (chainable)', async () => {
    const { eventBus } = await import('../../src/core/events.js');
    const result = eventBus.subscribe('test-topic', () => {});
    // subscribe returns this (the EventBus)
    expect(result).toBe(eventBus);
    // Clean up
    eventBus.unsubscribe('test-topic', () => {});
  });

  it('eventBus.publish does not throw', async () => {
    const { eventBus } = await import('../../src/core/events.js');
    let threw = false;
    try {
      eventBus.publish('test-topic', { value: 42 });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
