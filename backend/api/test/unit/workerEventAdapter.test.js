import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerEventAdapter } from '../../src/core/events/adapters/WorkerEventAdapter.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('WorkerEventAdapter', () => {
  let adapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new WorkerEventAdapter();
  });

  describe('constructor', () => {
    it('initializes _connected to true', () => {
      expect(adapter.isConnected).toBe(true);
    });

    it('initializes empty workers map', () => {
      expect(adapter._workers.size).toBe(0);
    });
  });

  describe('connect', () => {
    it('keeps connected true', async () => {
      await adapter.connect();
      expect(adapter.isConnected).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('sets connected to false', async () => {
      await adapter.disconnect();
      expect(adapter.isConnected).toBe(false);
    });

    it('terminates registered workers', async () => {
      const mockWorker = { terminate: vi.fn().mockResolvedValue(undefined) };
      adapter.registerWorker('test-worker', mockWorker);
      await adapter.disconnect();
      expect(mockWorker.terminate).toHaveBeenCalled();
    });
  });

  describe('registerWorker', () => {
    it('registers worker in _workers map', () => {
      const mockWorker = {};
      const result = adapter.registerWorker('batch-processor', mockWorker);
      expect(adapter._workers.get('batch-processor')).toBe(mockWorker);
      expect(result).toBe(adapter); // fluent
    });

    it('registers message handler for worker with .on method', () => {
      const mockWorker = { on: vi.fn() };
      adapter.registerWorker('listener', mockWorker);
      expect(mockWorker.on).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });

  describe('removeWorker', () => {
    it('removes worker from _workers map', () => {
      adapter.registerWorker('temp', {});
      adapter.removeWorker('temp');
      expect(adapter._workers.has('temp')).toBe(false);
    });

    it('is idempotent for non-existent worker', () => {
      adapter.removeWorker('ghost');
      // should not throw
    });
  });

  describe('onWorkerMessage', () => {
    it('registers handler for worker', () => {
      const handler = vi.fn();
      adapter.onWorkerMessage('test-worker', handler);
      expect(adapter._messageHandlers.get('test-worker')).toContain(handler);
    });

    it('accumulates multiple handlers for same worker', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      adapter.onWorkerMessage('test-worker', h1);
      adapter.onWorkerMessage('test-worker', h2);
      const handlers = adapter._messageHandlers.get('test-worker');
      expect(handlers).toHaveLength(2);
      expect(handlers).toContain(h1);
      expect(handlers).toContain(h2);
    });
  });

  describe('publish', () => {
    it('throws when not connected', async () => {
      adapter._connected = false;
      await expect(adapter.publish({ eventType: 'test' })).rejects.toThrow('Not connected');
    });

    it('calls postMessage on workers', async () => {
      const mockWorker = { postMessage: vi.fn() };
      adapter.registerWorker('dispatcher', mockWorker);

      await adapter.publish({ eventType: 'order.created', payload: { id: '123' } });

      expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'order.created',
        payload: { id: '123' },
      }));
    });

    it('calls send on workers without postMessage', async () => {
      const mockWorker = { send: vi.fn() };
      adapter.registerWorker('dispatcher', mockWorker);

      await adapter.publish({ eventType: 'order.created', payload: {} });

      expect(mockWorker.send).toHaveBeenCalled();
    });
  });
});
