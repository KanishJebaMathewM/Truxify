import logger from '../middleware/logger.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Asserts a monetary amount is a real, strictly positive, finite number.
 *
 * Without this, `Number('abc')` becomes NaN and `Number('-500')` stays negative,
 * and both flow straight into the escrow record and the release payout.
 */
function assertPositiveAmount(value, field) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new ValidationError(`${field} must be a finite number`);
  }
  if (amount <= 0) {
    throw new ValidationError(`${field} must be greater than 0`);
  }
  return amount;
}

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
  async depositLumperFee({ bookingId, brokerAddress, estimatedFeeAmount }) {
    const feeAmount = assertPositiveAmount(estimatedFeeAmount, 'estimatedFeeAmount');
    const escrowId = `LMP-${bookingId}-${Date.now()}`;
    const record = {
      escrowId,
      bookingId,
      brokerAddress,
      estimatedFeeAmount: feeAmount,
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
  async processReceiptAndRelease({ escrowId, driverWallet, receiptImageUrl, claimedAmount }) {
    if (!this.escrows.has(escrowId)) {
      throw new ValidationError('Lumper fee escrow not found');
    }

    if (!driverWallet || typeof driverWallet !== 'string' || !driverWallet.trim()) {
      throw new Error('driverWallet is required');
    }

    if (!receiptImageUrl || typeof receiptImageUrl !== 'string' || !receiptImageUrl.trim()) {
      throw new Error('receiptImageUrl is required');
    }

    const escrow = this.escrows.get(escrowId);

    if (escrow.status === 'RELEASED') {
      throw new ValidationError('Lumper fee escrow has already been released');
    }

    // Simulate AI parsing validation. An AI-parsed claim can never exceed the
    // amount actually held in escrow, and a NaN claim must not silently fall
    // back to the escrow amount via `||`.
    let parsedAmount = escrow.estimatedFeeAmount;
    if (claimedAmount !== undefined && claimedAmount !== null) {
      parsedAmount = assertPositiveAmount(claimedAmount, 'claimedAmount');
      if (parsedAmount > escrow.estimatedFeeAmount) {
        throw new ValidationError(
          `claimedAmount (${parsedAmount}) cannot exceed the escrowed estimatedFeeAmount (${escrow.estimatedFeeAmount})`
        );
      }
    }

    escrow.status = 'RELEASED';
    escrow.releasedAmount = parsedAmount;
    escrow.driverWallet = driverWallet.trim();
    escrow.receiptImageUrl = receiptImageUrl.trim();
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
export { assertPositiveAmount };
