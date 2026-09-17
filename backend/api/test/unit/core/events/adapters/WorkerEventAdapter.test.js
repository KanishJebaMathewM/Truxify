import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock EventPublisher
vi.mock('../../../EventPublisher.js', () => ({
  EventPublisher: class MockEventPublisher {
    constructor() {
      this._events = [];
    }
    _emit() {}
  },
}));

const { WorkerEventAdapter } = await import('../../../../../src/core/events/adapters/WorkerEventAdapter.js');

describe('WorkerEventAdapter', () => {
  let adapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new WorkerEventAdapter();
  });

  describe('constructor', () => {
    it('creates adapter with empty workers map', () => {
      expect(adapter._workers.size).toBe(0);
      expect(adapter._messageHandlers.size).toBe(0);
    });

    it('uses custom workerFactory when provided', () => {
      const factory = vi.fn();
      const a = new WorkerEventAdapter({ workerFactory: factory });
      expect(a._workerFactory).toBe(factory);
    });

    it('defaults workerFactory to null', () => {
      expect(adapter._workerFactory).toBeNull();
    });
  });

  describe('isConnected', () => {
    it('returns true initially', () => {
      expect(adapter.isConnected).toBe(true);
    });

    it('returns false after disconnect', async () => {
      await adapter.disconnect();
      expect(adapter.isConnected).toBe(false);
    });
  });

  describe('connect', () => {
    it('sets connected to true', async () => {
      adapter._connected = false;
      await adapter.connect();
      expect(adapter.isConnected).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('clears workers and handlers maps', async () => {
      const mockWorker = {
        terminate: vi.fn().mockResolvedValue(undefined),
      };
      adapter._workers.set('test-worker', mockWorker);
      adapter._messageHandlers.set('test-worker', [vi.fn()]);
      await adapter.disconnect();
      expect(adapter._workers.size).toBe(0);
      expect(adapter._messageHandlers.size).toBe(0);
    });

    it('sets connected to false', async () => {
      await adapter.disconnect();
      expect(adapter.isConnected).toBe(false);
    });

    it('handles worker without terminate gracefully', async () => {
      const mockWorker = {}; // no terminate method
      adapter._workers.set('test-worker', mockWorker);
      // Should not throw
      await expect(adapter.disconnect()).resolves.not.toThrow();
    });
  });

  describe('registerWorker', () => {
    it('registers worker and returns this', () => {
      const mockWorker = { on: vi.fn() };
      const result = adapter.registerWorker('test-worker', mockWorker);
      expect(result).toBe(adapter);
      expect(adapter._workers.get('test-worker')).toBe(mockWorker);
    });

    it('attaches message handler to worker with on method', () => {
      const onMock = vi.fn();
      const mockWorker = { on: onMock };
      adapter.registerWorker('w1', mockWorker);
      expect(onMock).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('skips attachment when worker has no on method', () => {
      const mockWorker = {};
      expect(() => adapter.registerWorker('w1', mockWorker)).not.toThrow();
    });
  });

  describe('removeWorker', () => {
    it('removes worker from maps and returns this', () => {
      adapter._workers.set('w1', {});
      adapter._messageHandlers.set('w1', [vi.fn()]);
      const result = adapter.removeWorker('w1');
      expect(result).toBe(adapter);
      expect(adapter._workers.has('w1')).toBe(false);
      expect(adapter._messageHandlers.has('w1')).toBe(false);
    });

    it('does nothing for non-existent worker', () => {
      expect(() => adapter.removeWorker('non-existent')).not.toThrow();
    });
  });

  describe('publish', () => {
    it('throws when not connected', async () => {
      adapter._connected = false;
      const event = { eventType: 'TEST', payload: {} };
      await expect(adapter.publish(event)).rejects.toThrow(/not connected/i);
    });

    it('sends message to registered workers via postMessage', async () => {
      const postMessageMock = vi.fn();
      adapter._workers.set('w1', { postMessage: postMessageMock });
      adapter._workers.set('w2', { send: vi.fn() }); // should not be called without postMessage
      const event = { eventType: 'ORDER_CREATED', payload: { orderId: '123' }, metadata: {} };
      await adapter.publish(event);
      expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ORDER_CREATED' }));
    });

    it('falls back to send when postMessage is absent', async () => {
      const sendMock = vi.fn();
      adapter._workers.set('w1', { send: sendMock });
      const event = { eventType: 'TEST', payload: {} };
      await adapter.publish(event);
      expect(sendMock).toHaveBeenCalled();
    });

    it('silently handles send/postMessage errors', async () => {
      const failingWorker = {
        postMessage: vi.fn(() => { throw new Error('postMessage error'); }),
      };
      adapter._workers.set('w1', failingWorker);
      const event = { eventType: 'TEST', payload: {} };
      // Should not throw
      await expect(adapter.publish(event)).resolves.not.toThrow();
    });
  });

  describe('onWorkerMessage', () => {
    it('registers handler for a worker', () => {
      const handler = vi.fn();
      adapter.onWorkerMessage('w1', handler);
      expect(adapter._messageHandlers.get('w1')).toContain(handler);
    });

    it('allows multiple handlers for same worker', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      adapter.onWorkerMessage('w1', h1);
      adapter.onWorkerMessage('w1', h2);
      const handlers = adapter._messageHandlers.get('w1');
      expect(handlers).toContain(h1);
      expect(handlers).toContain(h2);
    });
  });

  describe('_emitWorkerEvent', () => {
    it('calls registered handlers with event', () => {
      const handler = vi.fn();
      adapter.onWorkerMessage('w1', handler);
      const event = { type: 'TEST' };
      adapter._emitWorkerEvent('w1', event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('handles synchronous handler errors', () => {
      const handler = vi.fn(() => { throw new Error('handler error'); });
      adapter.onWorkerMessage('w1', handler);
      const event = {};
      // Should not throw
      expect(() => adapter._emitWorkerEvent('w1', event)).not.toThrow();
    });

    it('handles async handler rejection', () => {
      const handler = vi.fn(() => Promise.reject(new Error('async error')));
      adapter.onWorkerMessage('w1', handler);
      const event = {};
      // Should not throw — errors are caught internally
      expect(() => adapter._emitWorkerEvent('w1', event)).not.toThrow();
    });
  });
});
