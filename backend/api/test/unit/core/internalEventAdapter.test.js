import { describe, it, expect, vi, afterEach } from 'vitest';
import { InternalEventAdapter } from '../../../src/core/events/adapters/InternalEventAdapter.js';

describe('InternalEventAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new InternalEventAdapter();
  });

  afterEach(() => {
    adapter.removeAllListeners();
  });

  it('should start connected', () => {
    expect(adapter.isConnected).toBe(true);
  });

  it('should publish events', () => {
    const handler = vi.fn();
    adapter.on('TEST_EVENT', handler);

    adapter.publish({ eventType: 'TEST_EVENT', payload: { v: 1 } });

    expect(handler).toHaveBeenCalledTimes(1);
    const received = handler.mock.calls[0][0];
    expect(received.eventType).toBe('TEST_EVENT');
  });

  it('should subscribe to events', () => {
    const handler = vi.fn();
    adapter.subscribe('SUB_EVENT', handler);

    adapter.emit('SUB_EVENT', { eventType: 'SUB_EVENT' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should unsubscribe from events', () => {
    const handler = vi.fn();
    adapter.subscribe('UNSUB_EVENT', handler);
    adapter.unsubscribe('UNSUB_EVENT', handler);

    adapter.emit('UNSUB_EVENT', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('should throw when publishing while disconnected', async () => {
    await adapter.disconnect();
    await expect(adapter.publish({ eventType: 'X' })).rejects.toThrow('Not connected');
  });

  it('should throw when subscribing while disconnected', async () => {
    await adapter.disconnect();
    await expect(adapter.subscribe('X', () => {})).rejects.toThrow('Not connected');
  });

  it('should disconnect and remove all listeners', async () => {
    const handler = vi.fn();
    adapter.on('test', handler);
    await adapter.disconnect();
    expect(adapter.isConnected).toBe(false);
  });
});
