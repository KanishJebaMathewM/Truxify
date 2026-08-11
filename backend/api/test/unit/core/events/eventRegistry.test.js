import { describe, it, expect, vi } from 'vitest';
import { EventRegistry } from '../../../../src/core/events/EventRegistry.js';

describe('EventRegistry', () => {
  it('register stores an event definition without a validator', () => {
    const registry = new EventRegistry();
    const result = registry.register('order.created', { source: 'order-service' });
    expect(result).toBe(registry);
    expect(registry.isValid('order.created')).toBe(true);
    expect(registry.getDefinition('order.created')).toEqual({
      source: 'order-service',
      category: 'domain',
      description: '',
    });
  });

  it('register rejects a non-string event type', () => {
    const registry = new EventRegistry();
    expect(() => registry.register(42, {})).toThrow('eventType must be a non-empty string');
  });

  it('register rejects an empty event type', () => {
    const registry = new EventRegistry();
    expect(() => registry.register('', {})).toThrow('eventType must be a non-empty string');
  });

  it('registering the same event type overwrites the previous definition', () => {
    const registry = new EventRegistry();
    registry.register('order.created', { source: 'order-service' });
    registry.register('order.created', { source: 'payment-service', category: 'infrastructure', description: 'updated' });
    expect(registry.getDefinition('order.created')).toEqual({
      source: 'payment-service',
      category: 'infrastructure',
      description: 'updated',
    });
  });

  it('isValid returns false for an unregistered event type', () => {
    const registry = new EventRegistry();
    expect(registry.isValid('order.created')).toBe(false);
  });

  it('getDefinition returns null for an unregistered event type', () => {
    const registry = new EventRegistry();
    expect(registry.getDefinition('order.created')).toBeNull();
  });

  it('validate passes when no validator is registered', () => {
    const registry = new EventRegistry();
    registry.register('order.created', { source: 'order-service' });
    expect(registry.validate('order.created', {})).toEqual({ valid: true });
  });

  it('validate returns valid when a boolean validator returns true', () => {
    const registry = new EventRegistry();
    registry.register('order.created', { validator: () => true });
    expect(registry.validate('order.created', { payload: 1 })).toEqual({ valid: true });
  });

  it('validate surfaces a string error from a validator', () => {
    const registry = new EventRegistry();
    registry.register('order.created', { validator: () => 'payload must have an id' });
    expect(registry.validate('order.created', {})).toEqual({
      valid: false,
      error: 'payload must have an id',
    });
  });

  it('validate converts a throwing validator into a validation error', () => {
    const registry = new EventRegistry();
    registry.register('order.created', {
      validator: () => {
        throw new Error('boom');
      },
    });
    const result = registry.validate('order.created', {});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('boom');
  });

  it('validate returns an unknown-event-type error for unregistered types', () => {
    const registry = new EventRegistry();
    expect(registry.validate('order.created', {})).toEqual({
      valid: false,
      error: 'Unknown event type: order.created',
    });
  });

  it('getRegisteredTypes returns only registered event types', () => {
    const registry = new EventRegistry();
    registry.register('order.created', {});
    registry.register('order.cancelled', {});
    expect(registry.getRegisteredTypes().sort()).toEqual(['order.cancelled', 'order.created']);
  });

  it('remove clears both the definition and the validator', () => {
    const registry = new EventRegistry();
    registry.register('order.created', { validator: vi.fn(() => true) });
    expect(registry.isValid('order.created')).toBe(true);

    registry.remove('order.created');

    expect(registry.isValid('order.created')).toBe(false);
    expect(registry.getRegisteredTypes()).toEqual([]);
    expect(registry.validate('order.created', {})).toEqual({
      valid: false,
      error: 'Unknown event type: order.created',
    });
  });
});
