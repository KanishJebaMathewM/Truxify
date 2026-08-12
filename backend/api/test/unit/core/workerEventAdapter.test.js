import { describe, it, expect, vi } from 'vitest';
import { WorkerEventAdapter } from '../../../src/core/events/adapters/WorkerEventAdapter.js';

describe('WorkerEventAdapter', () => {
  it('should start connected', () => {
    const adapter = new WorkerEventAdapter();
    expect(adapter.isConnected).toBe(true);
  });

  it('should register and remove workers', () => {
    const adapter = new WorkerEventAdapter();
    const mockWorker = { postMessage: vi.fn(), on: vi.fn() };
    adapter.registerWorker('w1', mockWorker);
    adapter.removeWorker('w1');
  });

  it('should publish events to workers via postMessage', async () => {
    const adapter = new WorkerEventAdapter();
    const mockWorker = { postMessage: vi.fn(), on: vi.fn() };
    adapter.registerWorker('w1', mockWorker);

    await adapter.publish({
      eventType: 'TO_WORKER',
      payload: { data: 123 },
      metadata: { toJSON: () => ({ eventType: 'TO_WORKER' }) },
    });

    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
    const sent = mockWorker.postMessage.mock.calls[0][0];
    expect(sent.eventType).toBe('TO_WORKER');
    expect(sent.payload).toEqual({ data: 123 });
  });

  it('should publish to workers via send (child_process)', async () => {
    const adapter = new WorkerEventAdapter();
    const mockWorker = { send: vi.fn() };
    adapter.registerWorker('w2', mockWorker);

    await adapter.publish({
      eventType: 'TO_CHILD',
      payload: { v: 1 },
      metadata: { toJSON: () => ({}) },
    });

    expect(mockWorker.send).toHaveBeenCalledTimes(1);
  });

  it('should handle worker message callbacks', () => {
    const adapter = new WorkerEventAdapter();
    const mockWorker = { postMessage: vi.fn(), on: vi.fn() };
    adapter.registerWorker('w3', mockWorker);

    const messageHandler = vi.fn();
    adapter.onWorkerMessage('w3', messageHandler);

    // Simulate the worker registering its message handler
    const registeredHandler = mockWorker.on.mock.calls.find(c => c[0] === 'message');
    expect(registeredHandler).toBeDefined();

    // Simulate a message from the worker
    registeredHandler[1]({ eventType: 'FROM_WORKER', payload: { result: 42 } });
    expect(messageHandler).toHaveBeenCalledTimes(1);
    const received = messageHandler.mock.calls[0][0];
    expect(received.metadata.eventType).toBe('FROM_WORKER');
    expect(received.metadata.source).toBe('worker:w3');
  });

  it('should disconnect and terminate workers', async () => {
    const adapter = new WorkerEventAdapter();
    const mockWorker = { terminate: vi.fn(), postMessage: vi.fn(), on: vi.fn() };
    adapter.registerWorker('w4', mockWorker);

    await adapter.disconnect();
    expect(adapter.isConnected).toBe(false);
    expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it('should throw when publishing while disconnected', async () => {
    const adapter = new WorkerEventAdapter();
    await adapter.disconnect();
    await expect(adapter.publish({ eventType: 'X' })).rejects.toThrow('Not connected');
  });
});
