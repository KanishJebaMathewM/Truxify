import { describe, it, expect } from 'vitest';
import { EventRegistry } from '../../../src/core/events/EventRegistry.js';

describe('EventRegistry', () => {
  it('should register and retrieve event types', () => {
    const registry = new EventRegistry();
    registry.register('ORDER_CREATED', { source: 'order-service', description: 'Order was created' });
    expect(registry.isValid('ORDER_CREATED')).toBe(true);
    expect(registry.getDefinition('ORDER_CREATED')).toEqual({
      source: 'order-service',
      category: 'domain',
      description: 'Order was created',
    });
  });

  it('should reject unknown event types', () => {
    const registry = new EventRegistry();
    expect(registry.isValid('UNKNOWN')).toBe(false);
    expect(registry.getDefinition('UNKNOWN')).toBeNull();
  });

  it('should validate with registered validator', () => {
    const registry = new EventRegistry();
    registry.register('VALIDATED_EVENT', {
      validator: (payload) => payload && payload.requiredField ? true : 'requiredField is missing',
    });

    expect(registry.validate('VALIDATED_EVENT', { requiredField: 'yes' })).toEqual({ valid: true });
    expect(registry.validate('VALIDATED_EVENT', {})).toEqual({ valid: false, error: 'requiredField is missing' });
  });

  it('should return valid for events without validators', () => {
    const registry = new EventRegistry();
    registry.register('NO_VALIDATOR');
    expect(registry.validate('NO_VALIDATOR', {})).toEqual({ valid: true });
  });

  it('should return invalid for unregistered event types', () => {
    const registry = new EventRegistry();
    const result = registry.validate('UNREGISTERED', {});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unknown event type');
  });

  it('should list all registered types', () => {
    const registry = new EventRegistry();
    registry.register('A');
    registry.register('B');
    registry.register('C');
    expect(registry.getRegisteredTypes()).toEqual(['A', 'B', 'C']);
  });

  it('should remove event types', () => {
    const registry = new EventRegistry();
    registry.register('TO_REMOVE');
    expect(registry.isValid('TO_REMOVE')).toBe(true);
    registry.remove('TO_REMOVE');
    expect(registry.isValid('TO_REMOVE')).toBe(false);
  });

  it('should throw for non-string eventType', () => {
    const registry = new EventRegistry();
    expect(() => registry.register(123)).toThrow('eventType must be a non-empty string');
  });

  it('should handle validator that throws', () => {
    const registry = new EventRegistry();
    registry.register('THROWS', {
      validator: () => { throw new Error('validator crashed'); },
    });
    const result = registry.validate('THROWS', {});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('validator crashed');
  });
});
