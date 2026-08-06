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

  updateState(channelId, deltaAmount, recipient) {
    const state = this.activeChannels.get(channelId);
    if (!state) throw new Error(`Channel ${channelId} not found.`);

    state.sequence += 1;
    if (recipient === state.userB) {
      state.balanceA -= deltaAmount;
      state.balanceB += deltaAmount;
    } else {
      state.balanceA += deltaAmount;
      state.balanceB -= deltaAmount;
    }

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
