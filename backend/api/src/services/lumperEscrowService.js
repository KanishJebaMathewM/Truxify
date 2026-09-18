import logger from '../middleware/logger.js';

/**
 * Service managing lumper fee escrow smart contracts and receipt validation.
 */
class LumperEscrowService {
  constructor() {
    this.escrows = new Map();
  }

  /**
   * Deposits lumper fee into escrow contract for a given booking/load
   */
  async depositLumperFee({ bookingId, brokerAddress, estimatedFeeAmount } = {}) {
    if (!bookingId || !brokerAddress) {
      throw new Error('bookingId and brokerAddress are required');
    }
    const amount = Number(estimatedFeeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('estimatedFeeAmount must be a positive number');
    }

    const escrowId = `LMP-${bookingId}-${Date.now()}`;
    const record = {
      escrowId,
      bookingId,
      brokerAddress,
      estimatedFeeAmount: amount,
      status: 'HELD_IN_ESCROW',
      txHash: `0x${Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('')}`,
      createdAt: new Date().toISOString()
    };

    this.escrows.set(escrowId, record);
    logger.info(`[LumperEscrowService] Escrow created ${escrowId} for booking ${bookingId}`);

    return record;
  }

  /**
   * Processes uploaded receipt, parses with AI, and releases funds to driver
   */
  async processReceiptAndRelease({ escrowId, driverWallet, receiptImageUrl, claimedAmount } = {}) {
    if (!escrowId || !this.escrows.has(escrowId)) {
      throw new Error('Lumper fee escrow not found');
    }

    const escrow = this.escrows.get(escrowId);

    if (escrow.status === 'RELEASED') {
      throw new Error('Lumper fee escrow already released');
    }
    
    // Simulate AI parsing validation
const parsedAmount = claimedAmount !== undefined && claimedAmount !== null
      ? Number(claimedAmount)
      : escrow.estimatedFeeAmount;
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      throw new Error('claimedAmount must be a positive number');
    }
    if (parsedAmount > escrow.estimatedFeeAmount) {
      throw new Error('claimedAmount cannot exceed the estimated escrow amount');
    }
    
    escrow.status = 'RELEASED';
    escrow.releasedAmount = parsedAmount;
    escrow.driverWallet = driverWallet;
    escrow.receiptImageUrl = receiptImageUrl;
    escrow.releaseTxHash = `0x${Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('')}`;
    escrow.releasedAt = new Date().toISOString();

    this.escrows.set(escrowId, escrow);
    logger.info(`[LumperEscrowService] Escrow ${escrowId} released ${parsedAmount} to ${driverWallet}`);

    return escrow;
  }

  /**
   * Gets escrow status by ID
   */
  async getEscrowStatus(escrowId) {
    return this.escrows.get(escrowId) || null;
  }
}

export const lumperEscrowService = new LumperEscrowService();
export { LumperEscrowService };

