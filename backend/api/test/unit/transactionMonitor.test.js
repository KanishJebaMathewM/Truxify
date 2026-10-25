import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionMonitor } from '../../../src/services/blockchain/transactionMonitor.js';

describe('TransactionMonitor', () => {
  let monitor;
  let mockProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      getTransactionReceipt: vi.fn(),
    };
    monitor = new TransactionMonitor(mockProvider);
  });

  it('should add a pending transaction successfully', () => {
    const txHash = '0x12345';
    monitor.addPending(txHash);
    
    expect(monitor.getPendingTransactions()).toContain(txHash);
  });

  it('should mark a transaction as confirmed when receipt status is 1', async () => {
    const txHash = '0x12345';
    monitor.addPending(txHash);

    mockProvider.getTransactionReceipt.mockResolvedValueOnce({ status: 1 });

    const result = await monitor.checkTransaction(txHash);
    
    expect(result).toBe('confirmed');
    expect(monitor.getPendingTransactions()).not.toContain(txHash);
  });

  it('should mark a transaction as failed when receipt status is 0', async () => {
    const txHash = '0x12345';
    monitor.addPending(txHash);

    mockProvider.getTransactionReceipt.mockResolvedValueOnce({ status: 0 });

    const result = await monitor.checkTransaction(txHash);
    
    expect(result).toBe('failed');
    expect(monitor.getPendingTransactions()).not.toContain(txHash);
  });

  it('should handle RPC errors gracefully during polling', async () => {
    const txHash = '0x12345';
    monitor.addPending(txHash);

    mockProvider.getTransactionReceipt.mockRejectedValueOnce(new Error('RPC Connection Error'));

    await expect(monitor.checkTransaction(txHash)).resolves.toBe('pending');
    expect(monitor.getPendingTransactions()).toContain(txHash);
  });
});
