import logger from '../../middleware/logger.js';
import { GaslessRelayerService } from './gaslessRelayerService.js';
import { Eip712Signer } from './eip712Signer.js';

export const ESCROW_MILESTONES = Object.freeze({
  LOADING_ADVANCE: 1,       // Milestone 1: 30% advance on loading verification
  TRANSIT_WAYPOINT: 2,      // Milestone 2: 20% midpoint transit waypoint pass
  DELIVERY_SETTLEMENT: 3,   // Milestone 3: 50% final balance on OTP sign-off
});

export class EscrowMilestoneStateMachine {
  constructor(options = {}) {
    this.relayer = new GaslessRelayerService(options);
    this.signerHelper = new Eip712Signer(options);
  }

  /**
   * Triggers a milestone release meta-transaction on physical logistics verification.
   * 
   * @param {object} params
   * @param {string} params.bookingId - Booking UUID
   * @param {string} params.milestoneType - LOADING_ADVANCE, TRANSIT_WAYPOINT, or DELIVERY_SETTLEMENT
   * @param {string|bigint} params.amountWei - Amount in Wei
   * @param {number} params.nonce - Shipper account nonce
   * @param {number} params.deadline - Meta-tx deadline timestamp
   * @param {string} params.signature - Shipper's EIP-712 signature
   * @returns {Promise<object>} On-chain transaction confirmation
   */
  async triggerMilestoneRelease(params) {
    const {
      bookingId,
      milestoneType,
      amountWei,
      nonce,
      deadline,
      signature,
    } = params;

    const milestoneId = ESCROW_MILESTONES[milestoneType] || 1;

    logger.info(
      { bookingId, milestoneType, milestoneId, amountWei: amountWei.toString() },
      '[EscrowMilestoneStateMachine] Processing milestone trigger'
    );

    // 1. Submit on-chain via Gasless Relayer
    const relayerResult = await this.relayer.relayMilestoneRelease({
      bookingId,
      milestoneId,
      amount: amountWei,
      nonce,
      deadline,
      signature,
    });

    return {
      success: true,
      bookingId,
      milestoneType,
      milestoneId,
      transactionHash: relayerResult.transactionHash,
      blockNumber: relayerResult.blockNumber,
      gasUsed: relayerResult.gasUsed,
      releasedAt: new Date().toISOString(),
    };
  }
}

export default EscrowMilestoneStateMachine;
