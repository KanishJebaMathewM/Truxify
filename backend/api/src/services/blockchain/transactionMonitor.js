/**
 * TransactionMonitor service
 * Monitors pending blockchain transactions and updates their status via RPC provider receipts.
 */
export class TransactionMonitor {
  constructor(provider) {
    this.provider = provider;
    this.pendingTransactions = new Set();
  }

  /**
   * Add transaction hash to the pending queue
   * @param {string} txHash
   */
  addPending(txHash) {
    this.pendingTransactions.add(txHash);
  }

  /**
   * Get all currently tracked pending transaction hashes
   * @returns {string[]}
   */
  getPendingTransactions() {
    return Array.from(this.pendingTransactions);
  }

  /**
   * Check transaction receipt status from the RPC provider
   * @param {string} txHash
   * @returns {Promise<'confirmed' | 'failed' | 'pending'>}
   */
  async checkTransaction(txHash) {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return 'pending';
      }
      if (receipt.status === 1) {
        this.pendingTransactions.delete(txHash);
        return 'confirmed';
      }
      if (receipt.status === 0) {
        this.pendingTransactions.delete(txHash);
        return 'failed';
      }
      return 'pending';
    } catch {
      return 'pending';
    }
  }
}

export default TransactionMonitor;
