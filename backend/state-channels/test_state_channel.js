import { StateChannelManager } from './channel_manager.js';
import assert from 'assert';
import { generateKeyPairSync } from 'crypto';

console.log('Testing StateChannelManager...');

const manager = new StateChannelManager();
const channelId = 'channel-001';
const userA = '0xAAAA';
const userB = '0xBBBB';
const state = manager.createChannelState(channelId, userA, userB, 1000, 0);
assert.strictEqual(state.balanceA, 1000);

// Genuine update: userA (payer) signs the new state payload.
const keyPairA = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKeyA = keyPairA.publicKey.export({ type: 'spki', format: 'pem' });
const nextState = { channelId, sequence: state.sequence + 1, balanceA: 750, balanceB: 250, signatures: [] };
const signatureA = manager.signState(nextState, keyPairA.privateKey);

const updated = manager.updateState(channelId, 250, userB, signatureA, publicKeyA);
assert.strictEqual(updated.balanceA, 750);
assert.strictEqual(updated.balanceB, 250);
assert.strictEqual(updated.sequence, 1);

// Reverse payment: userB pays userA, signed by userB.
const keyPairB = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKeyB = keyPairB.publicKey.export({ type: 'spki', format: 'pem' });
const nextState2 = { channelId, sequence: 2, balanceA: 800, balanceB: 200, signatures: [] };
const signatureB = manager.signState(nextState2, keyPairB.privateKey);
const updated2 = manager.updateState(channelId, 50, userA, signatureB, publicKeyB);
assert.strictEqual(updated2.balanceA, 800);
assert.strictEqual(updated2.balanceB, 200);

// Missing signature must be rejected.
assert.throws(() => manager.updateState(channelId, 10, userB), /Signature is required/);

// Signature from the wrong key must be rejected.
const attacker = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const nextState3 = { channelId, sequence: 3, balanceA: 700, balanceB: 300, signatures: [] };
const forgedSignature = manager.signState(nextState3, attacker.privateKey);
assert.throws(
  () => manager.updateState(channelId, 100, userB, forgedSignature, publicKeyA),
  /Invalid signature/
);

// Signature over a different payload must be rejected.
const staleState = { channelId, sequence: 1, balanceA: 750, balanceB: 250, signatures: [] };
const staleSignature = manager.signState(staleState, keyPairA.privateKey);
assert.throws(
  () => manager.updateState(channelId, 100, userB, staleSignature, publicKeyA),
  /Invalid signature/
);

console.log('✅ StateChannelManager tests passed successfully.');
