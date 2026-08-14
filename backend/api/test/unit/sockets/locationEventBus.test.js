import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateInternalEvent, createLocationEventBus } from '../../../src/sockets/locationEventBus.js';

describe('locationEventBus', () => {
  describe('validateInternalEvent', () => {
    const validEvent = () => ({
      type: 'location_update',
      v: 1,
      driverId: 'driver-123',
      sourceInstanceId: 'instance-abc',
      sequence: 42,
      location: { lat: 12.9716, lng: 77.5946 },
    });

    it('returns null for valid event', () => {
      expect(validateInternalEvent(validEvent())).toBeNull();
    });

    it('returns "not-an-object" for null', () => {
      expect(validateInternalEvent(null)).toBe('not-an-object');
    });

    it('returns "not-an-object" for array', () => {
      expect(validateInternalEvent([])).toBe('not-an-object');
    });

    it('returns "unknown-type" for wrong type', () => {
      const event = validEvent();
      event.type = 'wrong_type';
      expect(validateInternalEvent(event)).toBe('unknown-type');
    });

    it('returns "unsupported-version" for wrong version', () => {
      const event = validEvent();
      event.v = 99;
      expect(validateInternalEvent(event)).toBe('unsupported-version');
    });

    it('returns "invalid-driverId" for empty driverId', () => {
      const event = validEvent();
      event.driverId = '';
      expect(validateInternalEvent(event)).toBe('invalid-driverId');
    });

    it('returns "invalid-driverId" for non-string driverId', () => {
      const event = validEvent();
      event.driverId = 123;
      expect(validateInternalEvent(event)).toBe('invalid-driverId');
    });

    it('returns "invalid-driverId" for too-long driverId', () => {
      const event = validEvent();
      event.driverId = 'a'.repeat(65);
      expect(validateInternalEvent(event)).toBe('invalid-driverId');
    });

    it('returns "invalid-sourceInstanceId" for empty sourceInstanceId', () => {
      const event = validEvent();
      event.sourceInstanceId = '';
      expect(validateInternalEvent(event)).toBe('invalid-sourceInstanceId');
    });

    it('returns "invalid-sequence" for negative sequence', () => {
      const event = validEvent();
      event.sequence = -1;
      expect(validateInternalEvent(event)).toBe('invalid-sequence');
    });

    it('returns "invalid-sequence" for non-finite sequence', () => {
      const event = validEvent();
      event.sequence = Infinity;
      expect(validateInternalEvent(event)).toBe('invalid-sequence');
    });

    it('returns "invalid-lat" for latitude out of range', () => {
      const event = validEvent();
      event.location = { lat: 91, lng: 77.5946 };
      expect(validateInternalEvent(event)).toBe('invalid-lat');
    });

    it('returns "invalid-lat" for NaN latitude', () => {
      const event = validEvent();
      event.location = { lat: NaN, lng: 77.5946 };
      expect(validateInternalEvent(event)).toBe('invalid-lat');
    });

    it('returns "invalid-lng" for longitude out of range', () => {
      const event = validEvent();
      event.location = { lat: 12.9716, lng: 181 };
      expect(validateInternalEvent(event)).toBe('invalid-lng');
    });

    it('accepts optional speed and bearing', () => {
      const event = validEvent();
      event.location.speed = 60;
      event.location.bearing = 180;
      expect(validateInternalEvent(event)).toBeNull();
    });

    it('returns "invalid-speed" for negative speed', () => {
      const event = validEvent();
      event.location.speed = -1;
      expect(validateInternalEvent(event)).toBe('invalid-speed');
    });

    it('returns "invalid-bearing" for bearing out of range', () => {
      const event = validEvent();
      event.location.bearing = 400;
      expect(validateInternalEvent(event)).toBe('invalid-bearing');
    });

    it('accepts optional orderDisplayId', () => {
      const event = validEvent();
      event.orderDisplayId = '#FF20240115ABCDEFGHIJKL';
      expect(validateInternalEvent(event)).toBeNull();
    });

    it('returns "invalid-orderDisplayId" for too-long orderDisplayId', () => {
      const event = validEvent();
      event.orderDisplayId = 'a'.repeat(65);
      expect(validateInternalEvent(event)).toBe('invalid-orderDisplayId');
    });
  });

  describe('createLocationEventBus', () => {
    it('returns an object with expected methods', () => {
      const bus = createLocationEventBus();
      expect(typeof bus.init).toBe('function');
      expect(typeof bus.publish).toBe('function');
      expect(typeof bus.subscribe).toBe('function');
      expect(typeof bus.close).toBe('function');
      expect(typeof bus.isReady).toBe('function');
      expect(typeof bus.getMetrics).toBe('function');
    });

    it('isReady returns false when not initialized', () => {
      const bus = createLocationEventBus();
      expect(bus.isReady()).toBe(false);
    });

    it('publish returns false when no publisher', async () => {
      const bus = createLocationEventBus();
      const result = await bus.publish({ type: 'location_update', v: 1, driverId: 'd1', sourceInstanceId: 'i1', sequence: 1, location: { lat: 12.9, lng: 77.5 } });
      expect(result).toBe(false);
    });

    it('getMetrics returns a copy of metrics', () => {
      const bus = createLocationEventBus();
      const m1 = bus.getMetrics();
      const m2 = bus.getMetrics();
      expect(m1).not.toBe(m2);
      expect(m1).toEqual(m2);
    });

    it('subscribe throws for non-function handler', () => {
      const bus = createLocationEventBus();
      expect(() => bus.subscribe('not-a-function')).toThrow(TypeError);
    });

    it('subscribe returns unsubscribe function', () => {
      const bus = createLocationEventBus();
      const handler = vi.fn();
      const unsubscribe = bus.subscribe(handler);
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('recordDelivery increments delivered count', () => {
      const bus = createLocationEventBus();
      bus.recordDelivery(5);
      expect(bus.getMetrics().delivered).toBe(5);
    });

    it('recordNoSubscribers increments droppedNoSubscribers count', () => {
      const bus = createLocationEventBus();
      bus.recordNoSubscribers();
      expect(bus.getMetrics().droppedNoSubscribers).toBe(1);
    });
  });
});
