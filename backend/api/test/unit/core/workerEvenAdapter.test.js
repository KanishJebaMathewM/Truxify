import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerEventAdapter } from '../../../src/core/events/adapters/WorkerEventAdapter.js';

describe('WorkerEventAdapter', () => {
  let adapter;
  let mockWorker;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new WorkerEventAdapter();
    mockWorker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };
  });

  it('should connect successfully', async () => {
    await expect(adapter.connect()).resolves.not.toThrow();
    expect(adapter.isConnected).toBe(true);
  });

  it('should disconnect and cleanup workers', async () => {
    await adapter.connect();
    adapter.registerWorker('worker-1', mockWorker);

    await adapter.disconnect();
    
    expect(adapter.isConnected).toBe(false);
    expect(mockWorker.terminate).toHaveBeenCalled();
  });

  it('should register and remove workers correctly', async () => {
    await adapter.connect();
    adapter.registerWorker('worker-1', mockWorker);
    adapter.removeWorker('worker-1');

    await adapter.publish({ eventType: 'TEST_EVENT', payload: { data: 1 } });

    expect(mockWorker.postMessage).not.toHaveBeenCalled();
  });

  it('should publish events through registered workers', async () => {
    await adapter.connect();
    adapter.registerWorker('worker-1', mockWorker);

    const event = { eventType: 'TEST_EVENT', payload: { data: 123 } };
    await adapter.publish(event);

    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      eventType: 'TEST_EVENT',
      payload: { data: 123 },
      metadata: undefined,
    });
  });
});
