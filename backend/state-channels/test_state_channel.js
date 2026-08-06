import { StateChannelManager } from './channel_manager.js';
import assert from 'assert';

console.log('Testing StateChannelManager...');

const manager = new StateChannelManager();
const channelId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const userA = '0xUserAAddress';
const userB = '0xUserBAddress';

const state = manager.createChannelState(channelId, userA, userB, 1000, 0);
assert.strictEqual(state.sequence, 0);
assert.strictEqual(state.balanceA, 1000);

manager.updateState(channelId, 250, userB);
const updatedState = manager.activeChannels.get(channelId);
assert.strictEqual(updatedState.sequence, 1);
assert.strictEqual(updatedState.balanceA, 750);
assert.strictEqual(updatedState.balanceB, 250);

console.log('✅ StateChannelManager tests passed successfully.');
