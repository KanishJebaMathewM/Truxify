import crypto from 'crypto';
import { ethers } from 'ethers';

/**
 * Off-Chain State Channel Manager for Truxify Freight Micro-Payments
 *
 * Enforces:
 * 1. Cryptographic signature verification over state payloads (ECDSA prime256v1 & EVM secp256k1)
 * 2. Monotonic nonce / sequence progression to prevent replay attacks
 * 3. Total balance conservation invariant (balanceA + balanceB == totalCapacity)
 * 4. Cooperative close vs unilateral dispute resolution with challenge timeouts
 */
export class StateChannelManager {
  constructor() {
    this.activeChannels = new Map();
    this.CHALLENGE_TIMEOUT_MS = 86400000; // 24-hour challenge period for unilateral disputes
  }

  /**
   * Initializes a new state channel between userA and userB
   * @param {string} channelId 
   * @param {string} userA 
   * @param {string} userB 
   * @param {number} initialBalanceA 
   * @param {number} initialBalanceB 
   * @returns {object} Channel state
   */
  createChannelState(channelId, userA, userB, initialBalanceA, initialBalanceB) {
    if (!channelId || typeof channelId !== 'string') {
      throw new Error('Invalid channelId: must be a non-empty string');
    }
    if (!userA || !userB) {
      throw new Error('Channel participants (userA, userB) must be defined');
    }
    if (typeof initialBalanceA !== 'number' || initialBalanceA < 0 ||
        typeof initialBalanceB !== 'number' || initialBalanceB < 0) {
      throw new Error('Initial balances must be non-negative numbers');
    }

    const totalCapacity = initialBalanceA + initialBalanceB;
    if (totalCapacity <= 0) {
      throw new Error('Total channel capacity must be greater than 0');
    }

    const channelState = {
      channelId,
      userA,
      userB,
      balanceA: initialBalanceA,
      balanceB: initialBalanceB,
      totalCapacity,
      sequence: 0,
      signatures: [],
      status: 'open',
      dispute: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.activeChannels.set(channelId, channelState);
    return channelState;
  }

  /**
   * Retrieves an active channel state
   * @param {string} channelId 
   * @returns {object}
   */
  getChannelState(channelId) {
    const state = this.activeChannels.get(channelId);
    if (!state) throw new Error(`Channel ${channelId} not found.`);
    return state;
  }

  /**
   * Signs a state update using either a Node.js crypto KeyObject / PEM or EVM private key
   * @param {object} state 
   * @param {crypto.KeyObject|string} privateKey 
   * @returns {string} Hex-encoded signature
   */
  signState(state, privateKey) {
    const payload = `${state.channelId}:${state.sequence}:${state.balanceA}:${state.balanceB}`;

    if (typeof privateKey === 'string' && /^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      // EVM wallet signature
      const wallet = new ethers.Wallet(privateKey);
      const signature = wallet.signMessageSync(payload);
      state.signatures.push(signature);
      return signature;
    }

    // Standard Node.js crypto signature (prime256v1 PEM or KeyObject)
    const sign = crypto.createSign('SHA256');
    sign.update(payload);
    sign.end();
    const signature = sign.sign(privateKey, 'hex');
    state.signatures.push(signature);
    return signature;
  }

  /**
   * Verifies the cryptographic signature of a proposed state update
   * @param {string} payload 
   * @param {string} signature 
   * @param {string|crypto.KeyObject} publicKeyOrAddress 
   * @returns {boolean}
   */
  verifySignature(payload, signature, publicKeyOrAddress) {
    if (!signature || !publicKeyOrAddress) {
      return false;
    }

    try {
      // If publicKeyOrAddress is an Ethereum address format
      if (typeof publicKeyOrAddress === 'string' && ethers.isAddress(publicKeyOrAddress)) {
        const recovered = ethers.verifyMessage(payload, signature);
        return recovered.toLowerCase() === publicKeyOrAddress.toLowerCase();
      }

      // Standard crypto verify (PEM format or KeyObject)
      const verify = crypto.createVerify('SHA256');
      verify.update(payload);
      verify.end();
      return verify.verify(publicKeyOrAddress, signature, 'hex');
    } catch {
      return false;
    }
  }

  /**
   * Updates state channel balances with monotonic sequence progression and cryptographic verification
   * @param {string} channelId 
   * @param {number} deltaAmount 
   * @param {string} recipient 
   * @param {string} [signature] 
   * @param {string|crypto.KeyObject} [publicKey] 
   * @param {string} [callerAddress] 
   * @returns {object} Updated channel state
   */
  updateState(channelId, deltaAmount, recipient, signature = null, publicKey = null, callerAddress = null) {
    const state = this.activeChannels.get(channelId);
    if (!state) throw new Error(`Channel ${channelId} not found.`);

    if (state.status === 'closed') {
      throw new Error(`Channel ${channelId} is closed and cannot be updated.`);
    }

    if (typeof deltaAmount !== 'number' || !Number.isFinite(deltaAmount) || deltaAmount <= 0) {
      throw new Error(`Invalid deltaAmount: ${deltaAmount}`);
    }

    if (callerAddress !== null && callerAddress !== state.userA && callerAddress !== state.userB) {
      throw new Error(`Caller ${callerAddress} is not authorized to update channel ${channelId}`);
    }

    // Require signature verification for security
    if (!signature) {
      throw new Error('Signature is required for state update');
    }

    let candidateBalanceA = state.balanceA;
    let candidateBalanceB = state.balanceB;

    if (recipient === state.userB) {
      if (state.balanceA < deltaAmount) {
        throw new Error(`Insufficient balance in channel ${channelId}: balanceA=${state.balanceA}, requested=${deltaAmount}`);
      }
      candidateBalanceA -= deltaAmount;
      candidateBalanceB += deltaAmount;
    } else if (recipient === state.userA) {
      if (state.balanceB < deltaAmount) {
        throw new Error(`Insufficient balance in channel ${channelId}: balanceB=${state.balanceB}, requested=${deltaAmount}`);
      }
      candidateBalanceA += deltaAmount;
      candidateBalanceB -= deltaAmount;
    } else {
      throw new Error(`Recipient ${recipient} is not part of channel ${channelId}`);
    }

    // Conservation invariant: total balance must remain invariant
    if (candidateBalanceA + candidateBalanceB !== state.totalCapacity) {
      throw new Error(`Balance conservation invariant violated: sum (${candidateBalanceA + candidateBalanceB}) !== totalCapacity (${state.totalCapacity})`);
    }

    // Monotonic sequence increment
    const candidateSequence = state.sequence + 1;
    const expectedPayload = `${channelId}:${candidateSequence}:${candidateBalanceA}:${candidateBalanceB}`;

    if (!publicKey) {
      throw new Error('Public key or address required to verify state update signature');
    }

    const isValid = this.verifySignature(expectedPayload, signature, publicKey);
    if (!isValid) {
      throw new Error(`Invalid signature for channel ${channelId} sequence ${candidateSequence}`);
    }

    // Update state
    state.balanceA = candidateBalanceA;
    state.balanceB = candidateBalanceB;
    state.sequence = candidateSequence;
    state.signatures.push(signature);
    state.updatedAt = Date.now();

    return state;
  }

  /**
   * Initiates a unilateral dispute challenge using the highest known signed state
   * @param {string} channelId 
   * @param {object} proposedState 
   * @param {string} signature 
   * @param {string|crypto.KeyObject} publicKey 
   * @returns {object} Dispute info
   */
  initiateDispute(channelId, proposedState, signature, publicKey) {
    const state = this.getChannelState(channelId);

    if (state.status === 'closed') {
      throw new Error(`Channel ${channelId} is already closed.`);
    }

    if (proposedState.sequence < state.sequence) {
      throw new Error(`Dispute state sequence (${proposedState.sequence}) is older than current channel sequence (${state.sequence})`);
    }

    const payload = `${channelId}:${proposedState.sequence}:${proposedState.balanceA}:${proposedState.balanceB}`;
    const isValid = this.verifySignature(payload, signature, publicKey);
    if (!isValid) {
      throw new Error('Invalid signature on dispute state payload');
    }

    // Invariant check
    if (proposedState.balanceA + proposedState.balanceB !== state.totalCapacity) {
      throw new Error('Dispute state violates channel total capacity conservation');
    }

    const now = Date.now();
    state.status = 'disputed';
    state.dispute = {
      sequence: proposedState.sequence,
      balanceA: proposedState.balanceA,
      balanceB: proposedState.balanceB,
      disputeInitiatedAt: now,
      expiresAt: now + this.CHALLENGE_TIMEOUT_MS,
      finalSignature: signature
    };

    return state.dispute;
  }

  /**
   * Counter-challenges a dispute with a strictly higher valid sequence number
   * @param {string} channelId 
   * @param {object} higherState 
   * @param {string} signature 
   * @param {string|crypto.KeyObject} publicKey 
   * @returns {object} Updated dispute info
   */
  counterDispute(channelId, higherState, signature, publicKey) {
    const state = this.getChannelState(channelId);

    if (state.status !== 'disputed' || !state.dispute) {
      throw new Error(`Channel ${channelId} is not currently in a disputed state`);
    }

    if (Date.now() > state.dispute.expiresAt) {
      throw new Error(`Challenge window for channel ${channelId} has already expired.`);
    }

    if (higherState.sequence <= state.dispute.sequence) {
      throw new Error(`Counter-dispute sequence (${higherState.sequence}) must be strictly greater than active dispute sequence (${state.dispute.sequence})`);
    }

    const payload = `${channelId}:${higherState.sequence}:${higherState.balanceA}:${higherState.balanceB}`;
    const isValid = this.verifySignature(payload, signature, publicKey);
    if (!isValid) {
      throw new Error('Invalid signature on counter-dispute payload');
    }

    if (higherState.balanceA + higherState.balanceB !== state.totalCapacity) {
      throw new Error('Counter-dispute state violates channel balance conservation');
    }

    state.dispute.sequence = higherState.sequence;
    state.dispute.balanceA = higherState.balanceA;
    state.dispute.balanceB = higherState.balanceB;
    state.dispute.finalSignature = signature;
    state.dispute.updatedAt = Date.now();

    return state.dispute;
  }

  /**
   * Closes a state channel cooperatively with dual signatures, or settles after challenge expiration
   * @param {string} channelId 
   * @param {object} [cooperativeClose] 
   * @returns {object} Final settlement report
   */
  closeChannel(channelId, cooperativeClose = null) {
    const state = this.getChannelState(channelId);

    if (state.status === 'closed') {
      throw new Error(`Channel ${channelId} is already closed`);
    }

    if (cooperativeClose) {
      const { finalBalanceA, finalBalanceB, finalSequence, sigA, sigB, pubKeyA, pubKeyB } = cooperativeClose;
      if (finalBalanceA + finalBalanceB !== state.totalCapacity) {
        throw new Error('Cooperative close balances violate channel total capacity');
      }

      const payload = `${channelId}:${finalSequence}:${finalBalanceA}:${finalBalanceB}`;
      const validA = this.verifySignature(payload, sigA, pubKeyA);
      const validB = this.verifySignature(payload, sigB, pubKeyB);

      if (!validA || !validB) {
        throw new Error('Cooperative channel close requires valid signatures from both participants');
      }

      state.balanceA = finalBalanceA;
      state.balanceB = finalBalanceB;
      state.sequence = finalSequence;
      state.status = 'closed';
      state.closedAt = Date.now();

      return {
        channelId,
        settlementType: 'cooperative',
        finalBalanceA: state.balanceA,
        finalBalanceB: state.balanceB,
        sequence: state.sequence,
        closedAt: state.closedAt
      };
    }

    // Unilateral close requires expired challenge period
    if (state.status === 'disputed' && state.dispute) {
      if (Date.now() < state.dispute.expiresAt) {
        throw new Error(`Cannot settle disputed channel before challenge timeout expires (expires at ${state.dispute.expiresAt})`);
      }

      state.balanceA = state.dispute.balanceA;
      state.balanceB = state.dispute.balanceB;
      state.sequence = state.dispute.sequence;
      state.status = 'closed';
      state.closedAt = Date.now();

      return {
        channelId,
        settlementType: 'unilateral_dispute_settled',
        finalBalanceA: state.balanceA,
        finalBalanceB: state.balanceB,
        sequence: state.sequence,
        closedAt: state.closedAt
      };
    }

    throw new Error('Channel closure requires either cooperative dual signatures or an expired dispute settlement');
  }
}

export const channelManager = new StateChannelManager();