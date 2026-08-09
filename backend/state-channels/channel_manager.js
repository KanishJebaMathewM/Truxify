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

  updateState(channelId, deltaAmount, recipient, callerAddress = null) {
    const state = this.activeChannels.get(channelId);
    if (!state) throw new Error(`Channel ${channelId} not found.`);

    if (typeof deltaAmount !== 'number' || !Number.isFinite(deltaAmount) || deltaAmount <= 0) {
      throw new Error(`Invalid deltaAmount: ${deltaAmount}`);
    }

    if (callerAddress !== null && callerAddress !== state.userA) {
      throw new Error(`Caller ${callerAddress} is not authorized to update channel ${channelId}`);
    }

    if (recipient === state.userB) {
      if (state.balanceA < deltaAmount) {
        throw new Error(`Insufficient balance in channel ${channelId}: balanceA=${state.balanceA}, requested=${deltaAmount}`);
      }
      state.balanceA -= deltaAmount;
      state.balanceB += deltaAmount;
    } else if (recipient === state.userA) {
      if (state.balanceB < deltaAmount) {
        throw new Error(`Insufficient balance in channel ${channelId}: balanceB=${state.balanceB}, requested=${deltaAmount}`);
      }
      state.balanceA += deltaAmount;
      state.balanceB -= deltaAmount;
    } else {
      throw new Error(`Recipient ${recipient} is not part of channel ${channelId}`);
    }

    state.sequence += 1;

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