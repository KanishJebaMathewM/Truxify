import { describe, it, expect } from 'vitest';
import { KafkaAdapter } from '../../src/core/events/adapters/KafkaAdapter.js';

describe('KafkaAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new KafkaAdapter({ connect: vi.fn(), disconnect: vi.fn() });
  });

  describe('getTopic', () => {
    it('returns the mapped topic when set', () => {
      adapter.setTopicMap({ 'order.created': 'orders-topic' });
      expect(adapter.getTopic('order.created')).toBe('orders-topic');
    });

    it('falls back to dotted-name replacement', () => {
      expect(adapter.getTopic('order.created')).toBe('order_created');
    });

    it('falls back to the event type itself', () => {
      expect(adapter.getTopic('simple')).toBe('simple');
    });
  });

  describe('setTopicMap', () => {
    it('merges entries into the topic map', () => {
      adapter.setTopicMap({ a: 'topic-a', b: 'topic-b' });
      expect(adapter.getTopic('a')).toBe('topic-a');
      expect(adapter.getTopic('b')).toBe('topic-b');
    });
  });

  describe('connect / disconnect', () => {
    it('connects once', async () => {
      const connect = vi.fn().mockResolvedValue();
      adapter._kafkaConfig.connect = connect;
      await adapter.connect();
      await adapter.connect();
      expect(connect).toHaveBeenCalledTimes(1);
      expect(adapter.isConnected).toBe(true);
    });

    it('disconnects once', async () => {
      const disconnect = vi.fn().mockResolvedValue();
      adapter._kafkaConfig.disconnect = disconnect;
      adapter._connected = true;
      await adapter.disconnect();
      await adapter.disconnect();
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(adapter.isConnected).toBe(false);
    });

    it('rethrows connection errors', async () => {
      adapter._kafkaConfig.connect = vi.fn().mockRejectedValue(new Error('nope'));
      await expect(adapter.connect()).rejects.toThrow('nope');
      expect(adapter.isConnected).toBe(false);
    });
  });

  describe('publish', () => {
    it('publishes an event to the mapped topic', async () => {
      const publishEvent = vi.fn().mockResolvedValue();
      adapter._kafkaConfig.publishEvent = publishEvent;
      adapter.setTopicMap({ 'order.created': 'orders-topic' });
      await adapter.publish({
        eventType: 'order.created',
        payload: { id: 1 },
        metadata: { eventId: 'evt-1' },
      });
      expect(publishEvent).toHaveBeenCalledWith(
        'orders-topic',
        expect.objectContaining({ eventId: 'evt-1', eventType: 'order.created', data: { id: 1 } }),
        'evt-1',
      );
    });

    it('rethrows publish errors', async () => {
      adapter._kafkaConfig.publishEvent = vi.fn().mockRejectedValue(new Error('pub-fail'));
      await expect(adapter.publish({ eventType: 'a', payload: {} })).rejects.toThrow('pub-fail');
    });
  });
});
