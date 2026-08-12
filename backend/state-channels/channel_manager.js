import crypto from 'crypto';

/**
 * Off-Chain State Channel Manager for Truxify Freight Micro-Payments
 */
export class StateChannelManager {
  constructor() {
    this.activeChannels = new Map();
  }

  createChannelState(channelId, userA, userB, initialBalanceA, initialBalanceB) {
    const channelState = {
      channelId,
      userA,
      userB,
      balanceA: initialBalanceA,
      balanceB: initialBalanceB,
      sequence: 0,
      signatures: []
    };
    this.activeChannels.set(channelId, channelState);
    return channelState;
  }

  /**
   * Updates the channel state after verifying the payer's ECDSA signature over
   * the new state payload (channelId:sequence:balanceA:balanceB). Without the
   * signature the update is rejected, so a caller cannot move funds by calling
   * updateState directly with a spoofed address.
   */
  updateState(channelId, deltaAmount, recipient, signature, publicKeyPem) {
    const state = this.activeChannels.get(channelId);
    if (!state) throw new Error(`Channel ${channelId} not found.`);

    if (typeof deltaAmount !== 'number' || !Number.isFinite(deltaAmount) || deltaAmount <= 0) {
      throw new Error(`Invalid deltaAmount: ${deltaAmount}`);
    }

    if (!signature || typeof signature !== 'string' || signature.length === 0) {
      throw new Error(`Signature is required to update channel ${channelId}`);
    }

    if (!publicKeyPem || typeof publicKeyPem !== 'string' || publicKeyPem.length === 0) {
      throw new Error(`Payer public key is required to update channel ${channelId}`);
    }

    let nextBalanceA = state.balanceA;
    let nextBalanceB = state.balanceB;
    let payer = null;

    if (recipient === state.userB) {
      if (state.balanceA < deltaAmount) {
        throw new Error(`Insufficient balance in channel ${channelId}: balanceA=${state.balanceA}, requested=${deltaAmount}`);
      }
      nextBalanceA = state.balanceA - deltaAmount;
      nextBalanceB = state.balanceB + deltaAmount;
      payer = state.userA;
    } else if (recipient === state.userA) {
      if (state.balanceB < deltaAmount) {
        throw new Error(`Insufficient balance in channel ${channelId}: balanceB=${state.balanceB}, requested=${deltaAmount}`);
      }
      nextBalanceA = state.balanceA + deltaAmount;
      nextBalanceB = state.balanceB - deltaAmount;
      payer = state.userB;
    } else {
      throw new Error(`Recipient ${recipient} is not part of channel ${channelId}`);
    }

    // The payer signs the new state payload; verify it before committing.
    const nextSequence = state.sequence + 1;
    const payload = `${state.channelId}:${nextSequence}:${nextBalanceA}:${nextBalanceB}`;

    let valid;
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(payload);
      verify.end();
      valid = verify.verify(publicKeyPem, signature, 'hex');
    } catch {
      valid = false;
    }

    if (!valid) {
      throw new Error(`Invalid signature for channel ${channelId} update (payer ${payer})`);
    }

    state.balanceA = nextBalanceA;
    state.balanceB = nextBalanceB;
    state.sequence = nextSequence;
    state.signatures.push(signature);

    return state;
  }

  signState(state, privateKeyPem) {
    const payload = `${state.channelId}:${state.sequence}:${state.balanceA}:${state.balanceB}`;
    const sign = crypto.createSign('SHA256');
    sign.update(payload);
    sign.end();
    const signature = sign.sign(privateKeyPem, 'hex');
    state.signatures.push(signature);
    return signature;
  }
}

export const channelManager = new StateChannelManager();
