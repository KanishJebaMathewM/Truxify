import { describe, it, expect, vi, afterEach } from 'vitest';
import { eventBus } from '../../src/core/events.js';

describe('EventBus', () => {
  afterEach(() => {
    eventBus.removeAllListeners();
  });

  it('should emit and listen to events securely', () => {
    const listener = vi.fn();
    eventBus.on('test:event', listener);

    eventBus.emitSafe('test:event', { payload: 'data' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ payload: 'data' });
  });

  it('should return false when emitting with no listeners', () => {
    const result = eventBus.emitSafe('unheard:event', { foo: 'bar' });
    expect(result).toBe(false);
  });
  
  it('should notify multiple listeners safely', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    eventBus.on('multi', l1);
    eventBus.on('multi', l2);
    eventBus.emitSafe('multi', 123);
    expect(l1).toHaveBeenCalledWith(123);
    expect(l2).toHaveBeenCalledWith(123);
  });
});
