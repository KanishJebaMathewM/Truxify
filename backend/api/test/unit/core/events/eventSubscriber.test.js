import { describe, it, expect, vi } from 'vitest';
import { EventSubscriber } from '../../../../src/core/events/EventSubscriber.js';

describe('EventSubscriber adapter contract', () => {
  it('subscribe throws the must-be-implemented error on the base class', async () => {
    const sub = new EventSubscriber();
    await expect(sub.subscribe('order.created', () => {})).rejects.toThrow(
      'EventSubscriber.subscribe() must be implemented by adapter',
    );
  });

  it('unsubscribe throws the must-be-implemented error on the base class', async () => {
    const sub = new EventSubscriber();
    await expect(sub.unsubscribe('order.created', () => {})).rejects.toThrow(
      'EventSubscriber.unsubscribe() must be implemented by adapter',
    );
  });

  it('subscribeAll calls subscribe for every handler in object order', async () => {
    const calls = [];
    const sub = new EventSubscriber();
    sub.subscribe = vi.fn(async (eventType, handler) => {
      calls.push([eventType, handler]);
      return `subscribed:${eventType}`;
    });

    const handlerA = () => {};
    const handlerB = () => {};
    const results = await sub.subscribeAll({
      'order.created': handlerA,
      'order.cancelled': handlerB,
    });

    expect(sub.subscribe).toHaveBeenCalledTimes(2);
    expect(calls[0]).toEqual(['order.created', handlerA]);
    expect(calls[1]).toEqual(['order.cancelled', handlerB]);
    expect(results).toEqual(['subscribed:order.created', 'subscribed:order.cancelled']);
  });

  it('subscribeAll returns an empty array when no handlers are given', async () => {
    const sub = new EventSubscriber();
    sub.subscribe = vi.fn();
    const results = await sub.subscribeAll({});
    expect(results).toEqual([]);
    expect(sub.subscribe).not.toHaveBeenCalled();
  });

  it('subscribeAll re-throws when a handler subscribe rejects', async () => {
    const sub = new EventSubscriber();
    sub.subscribe = vi.fn(async () => {
      throw new Error('adapter failed');
    });

    await expect(sub.subscribeAll({ 'order.created': () => {} })).rejects.toThrow(
      'adapter failed',
    );
  });

  it('connect resolves without side effects on the base class', async () => {
    const sub = new EventSubscriber();
    await expect(sub.connect()).resolves.toBeUndefined();
  });

  it('disconnect resolves without side effects on the base class', async () => {
    const sub = new EventSubscriber();
    await expect(sub.disconnect()).resolves.toBeUndefined();
  });

  it('isConnected is false on a bare instance', () => {
    const sub = new EventSubscriber();
    expect(sub.isConnected).toBe(false);
  });
});
