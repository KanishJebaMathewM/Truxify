import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventHandler } from '../../../src/core/events/EventHandler.js';

describe('EventHandler', () => {
  afterEach(() => {});

  it('should wrap a function handler', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const handler = new EventHandler(fn, { name: 'customHandler' });
    expect(handler.name).toBe('customHandler');

    const result = await handler.handle({ eventType: 'TEST', payload: {} });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use custom name', () => {
    const handler = new EventHandler(() => {}, { name: 'custom' });
    expect(handler.name).toBe('custom');
  });

  it('should throw if not given a function', () => {
    expect(() => new EventHandler('not-a-function')).toThrow('EventHandler requires a function handler');
  });

  it('should invoke onError on failure', async () => {
    const errorFn = vi.fn().mockRejectedValue(new Error('fail'));
    const onError = vi.fn().mockReturnValue('recovered');
    const handler = new EventHandler(errorFn, { onError });

    const result = await handler.handle({});
    expect(result).toBe('recovered');
    expect(onError).toHaveBeenCalled();
  });

  it('should throw if handler errors and no onError', async () => {
    const errorFn = vi.fn().mockRejectedValue(new Error('crash'));
    const handler = new EventHandler(errorFn);

    await expect(handler.handle({})).rejects.toThrow('crash');
  });

  it('should timeout if handler takes too long', async () => {
    const slowFn = () => new Promise(resolve => setTimeout(resolve, 5000));
    const handler = new EventHandler(slowFn, { timeout: 50 });

    await expect(handler.handle({})).rejects.toThrow('timed out');
  });

  it('should respect zero timeout (no timeout)', async () => {
    const fastFn = vi.fn().mockResolvedValue('done');
    const handler = new EventHandler(fastFn, { timeout: 0 });

    const result = await handler.handle({});
    expect(result).toBe('done');
  });

  it('should provide static wrap helper', () => {
    const fn = vi.fn();
    const handler = EventHandler.wrap(fn, { name: 'wrapped' });
    expect(handler).toBeInstanceOf(EventHandler);
    expect(handler.name).toBe('wrapped');
  });
});
