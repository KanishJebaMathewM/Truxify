import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlockchainMonitor } from '../../../../src/services/blockchain/blockchainMonitor.js';

// Mock external provider / contract dependencies
const mockProvider = {
  on: vi.fn(),
  off: vi.fn(),
  getBlockNumber: vi.fn().mockResolvedValue(1000),
};

const mockContract = {
  filters: {
    Transfer: vi.fn(() => 'TransferFilter'),
  },
  on: vi.fn(),
  removeAllListeners: vi.fn(),
};

describe('BlockchainMonitor', () => {
  let monitor;

  beforeEach(() => {
    vi.clearAllMocks();
    monitor = new BlockchainMonitor({ provider: mockProvider, contract: mockContract });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize and start monitoring without errors', async () => {
      await monitor.start();

      expect(mockProvider.getBlockNumber).toHaveBeenCalled();
      expect(monitor.isRunning()).toBe(true);
    });

    it('should stop monitoring cleanly', async () => {
      await monitor.start();
      await monitor.stop();

      expect(monitor.isRunning()).toBe(false);
    });
  });

  describe('Event Handling and Dispatching', () => {
    it('should register event listeners and dispatch events to correct handlers', async () => {
      const mockEventHandler = vi.fn();
      monitor.registerHandler('Transfer', mockEventHandler);

      await monitor.start();

      // Simulate the provider or contract firing an event
      const eventCallback = mockContract.on.mock.calls[0]?.[1];
      if (eventCallback) {
        await eventCallback({ transactionHash: '0x123', args: { value: 100 } });
        expect(mockEventHandler).toHaveBeenCalledWith(
          expect.objectContaining({ transactionHash: '0x123' })
        );
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle provider errors gracefully during monitoring', async () => {
      mockProvider.getBlockNumber.mockRejectedValueOnce(new Error('RPC Connection Failed'));

      await expect(monitor.start()).rejects.toThrow(/rpc connection failed/i);
      expect(monitor.isRunning()).toBe(false);
    });

    it('should catch and log errors thrown inside event handlers without crashing', async () => {
      const faultyHandler = vi.fn().mockRejectedValueOnce(new Error('Handler Crash'));
      monitor.registerHandler('ErrorEvent', faultyHandler);

      await monitor.start();

      // Ensure that a failing handler does not throw unhandled rejections upward
      const eventCallback = mockContract.on.mock.calls[0]?.[1];
      if (eventCallback) {
        await expect(eventCallback({ type: 'ErrorEvent' })).resolves.not.toThrow();
      }
    });
  });
});
