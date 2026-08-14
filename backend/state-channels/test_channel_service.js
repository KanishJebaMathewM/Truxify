import assert from 'assert';
import { ethers } from 'ethers';

// Provide minimal env so the singleton service can be constructed offline
// (ethers only touches the network when a method is actually invoked).
process.env.POLYGON_RPC_URL = 'http://localhost:8545';
process.env.RELAYER_WALLET_PRIVATE_KEY = '0x' + '1'.repeat(64);
process.env.STATE_CHANNEL_ADDRESS = '0x' + '2'.repeat(40);

const { normalizeChannelValue, default: channelService } = await import('./channel.service.js');

console.log('Testing channel deposit unit normalization...');

// 1.5 ether must normalize to 1.5e18 wei, NOT 1e36 wei (the old parseEther
// mis-scale that occurred for already-large / float inputs).
const onePointFive = normalizeChannelValue('1.5');
assert.strictEqual(onePointFive.toString(), ethers.parseEther('1.5').toString());
assert.strictEqual(onePointFive.toString(), '1500000000000000000');

// A plain integer amount is scaled explicitly to 18 decimals.
assert.strictEqual(normalizeChannelValue('2').toString(), '2000000000000000000');

// A float passed as a number is handled deterministically.
assert.strictEqual(normalizeChannelValue(0.1).toString(), '100000000000000000');

// Non-positive / junk input is rejected, not silently mis-scaled.
assert.throws(() => normalizeChannelValue('0'), /Invalid channel value/);
assert.throws(() => normalizeChannelValue('-1'), /Invalid channel value/);
assert.throws(() => normalizeChannelValue('abc'), /Invalid channel value/);
assert.throws(() => normalizeChannelValue(''), /Invalid channel value/);

console.log('✅ Deposit unit normalization tests passed.');

console.log('Testing channelCache consistency...');

const channelId = '0x' + 'a'.repeat(64);
const userA = '0x' + '3'.repeat(40);
const userB = '0x' + '4'.repeat(40);
const valueWei = ethers.parseUnits('1.5', 18);

// Record on open -> cache is populated and readable (fast-path consistency).
channelService._recordOpenedChannel(channelId, userA, userB, valueWei);
const cached = channelService._readCachedChannel(channelId);
assert.ok(cached, 'channel should be cached after open');
assert.strictEqual(cached.channelId, channelId);
assert.strictEqual(cached.userA, userA);
assert.strictEqual(cached.userB, userB);
assert.strictEqual(cached.balanceA, valueWei.toString());
assert.strictEqual(cached.isClosed, false);

// Mark closed -> cache reflects settlement consistently.
channelService._markChannelClosed(channelId);
assert.strictEqual(channelService._readCachedChannel(channelId).isClosed, true);

// Unknown channel is not served from the dead cache.
assert.strictEqual(channelService._readCachedChannel('0x' + 'f'.repeat(64)), null);

console.log('✅ channelCache consistency tests passed.');

console.log('✅ All state-channel regression tests passed.');
