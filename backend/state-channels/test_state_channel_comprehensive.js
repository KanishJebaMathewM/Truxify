import { StateChannelManager } from './channel_manager.js';
import assert from 'assert';
import { generateKeyPairSync } from 'crypto';
import { ethers } from 'ethers';

console.log('--- Running Comprehensive State Channel Manager & Cryptographic Guard Unit Tests ---');

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

// 1. Channel Creation & Invariants
test('createChannelState initializes channel with correct capacity and sequence 0', () => {
  const manager = new StateChannelManager();
  const state = manager.createChannelState('chan-test-01', '0xAlice', '0xBob', 500, 250);

  assert.strictEqual(state.channelId, 'chan-test-01');
  assert.strictEqual(state.userA, '0xAlice');
  assert.strictEqual(state.userB, '0xBob');
  assert.strictEqual(state.balanceA, 500);
  assert.strictEqual(state.balanceB, 250);
  assert.strictEqual(state.totalCapacity, 750);
  assert.strictEqual(state.sequence, 0);
  assert.strictEqual(state.status, 'open');
  assert.strictEqual(state.signatures.length, 0);
});

test('createChannelState rejects invalid inputs (negative balances, empty channelId)', () => {
  const manager = new StateChannelManager();
  assert.throws(() => manager.createChannelState('', '0xAlice', '0xBob', 100, 100), /Invalid channelId/);
  assert.throws(() => manager.createChannelState('chan-err', null, '0xBob', 100, 100), /participants .* must be defined/);
  assert.throws(() => manager.createChannelState('chan-err', '0xAlice', '0xBob', -10, 100), /Initial balances must be non-negative/);
  assert.throws(() => manager.createChannelState('chan-err', '0xAlice', '0xBob', 0, 0), /capacity must be greater than 0/);
});

// 2. EVM Wallet Signature Support
test('signState and verifySignature support standard EVM wallets and Ethereum addresses', () => {
  const manager = new StateChannelManager();
  const walletA = ethers.Wallet.createRandom();
  const state = {
    channelId: 'evm-chan-01',
    sequence: 1,
    balanceA: 800,
    balanceB: 200,
    signatures: []
  };

  const sig = manager.signState(state, walletA.privateKey);
  assert.strictEqual(typeof sig, 'string');
  assert.strictEqual(sig.startsWith('0x'), true);

  const payload = `${state.channelId}:${state.sequence}:${state.balanceA}:${state.balanceB}`;
  const isValid = manager.verifySignature(payload, sig, walletA.address);
  assert.strictEqual(isValid, true);

  // Mismatched address fails
  const randomWallet = ethers.Wallet.createRandom();
  assert.strictEqual(manager.verifySignature(payload, sig, randomWallet.address), false);

  // Altered payload fails
  assert.strictEqual(manager.verifySignature('altered-payload', sig, walletA.address), false);
});

// 3. NIST P-256 ECDSA PEM Signatures
test('signState and verifySignature support Node crypto NIST P-256 KeyPairs', () => {
  const manager = new StateChannelManager();
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' });

  const state = {
    channelId: 'ec-chan-01',
    sequence: 1,
    balanceA: 700,
    balanceB: 300,
    signatures: []
  };

  const sig = manager.signState(state, keyPair.privateKey);
  const payload = `${state.channelId}:${state.sequence}:${state.balanceA}:${state.balanceB}`;
  assert.strictEqual(manager.verifySignature(payload, sig, pubPem), true);
});

// 4. Bi-directional state updates and balance conservation
test('updateState correctly handles userA paying userB and userB paying userA', () => {
  const manager = new StateChannelManager();
  const channelId = 'bidirectional-01';
  const userA = '0xAlice';
  const userB = '0xBob';
  manager.createChannelState(channelId, userA, userB, 1000, 0);

  const keyA = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubA = keyA.publicKey.export({ type: 'spki', format: 'pem' });
  const keyB = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubB = keyB.publicKey.export({ type: 'spki', format: 'pem' });

  // A pays B 300
  const candidate1 = { channelId, sequence: 1, balanceA: 700, balanceB: 300, signatures: [] };
  const sigA = manager.signState(candidate1, keyA.privateKey);
  const state1 = manager.updateState(channelId, 300, userB, sigA, pubA);

  assert.strictEqual(state1.balanceA, 700);
  assert.strictEqual(state1.balanceB, 300);
  assert.strictEqual(state1.sequence, 1);
  assert.strictEqual(state1.balanceA + state1.balanceB, 1000);

  // B pays A 100
  const candidate2 = { channelId, sequence: 2, balanceA: 800, balanceB: 200, signatures: [] };
  const sigB = manager.signState(candidate2, keyB.privateKey);
  const state2 = manager.updateState(channelId, 100, userA, sigB, pubB);

  assert.strictEqual(state2.balanceA, 800);
  assert.strictEqual(state2.balanceB, 200);
  assert.strictEqual(state2.sequence, 2);
  assert.strictEqual(state2.balanceA + state2.balanceB, 1000);
});

// 5. Update boundary and authorization errors
test('updateState rejects unauthorized callers, non-existent channels, and insufficient funds', () => {
  const manager = new StateChannelManager();
  const channelId = 'guard-01';
  manager.createChannelState(channelId, '0xAlice', '0xBob', 100, 50);

  const keyA = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubA = keyA.publicKey.export({ type: 'spki', format: 'pem' });
  const candidate = { channelId, sequence: 1, balanceA: 0, balanceB: 150, signatures: [] };
  const sigA = manager.signState(candidate, keyA.privateKey);

  // Unauthorized caller
  assert.throws(
    () => manager.updateState(channelId, 100, '0xBob', sigA, pubA, '0xAttacker'),
    /Caller 0xAttacker is not authorized/
  );

  // Non-existent channel
  assert.throws(
    () => manager.updateState('ghost-channel', 10, '0xBob', sigA, pubA),
    /Channel ghost-channel not found/
  );

  // Insufficient balance
  assert.throws(
    () => manager.updateState(channelId, 200, '0xBob', sigA, pubA),
    /Insufficient balance/
  );

  // Invalid delta amount
  assert.throws(() => manager.updateState(channelId, 0, '0xBob', sigA, pubA), /Invalid deltaAmount/);
  assert.throws(() => manager.updateState(channelId, -5, '0xBob', sigA, pubA), /Invalid deltaAmount/);
});

// 6. Signature and Nonce Tampering Guards
test('updateState rejects forged or mismatched signatures', () => {
  const manager = new StateChannelManager();
  const channelId = 'tamper-01';
  manager.createChannelState(channelId, '0xAlice', '0xBob', 500, 500);

  const keyA = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubA = keyA.publicKey.export({ type: 'spki', format: 'pem' });
  const attackerKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  // Missing signature
  assert.throws(() => manager.updateState(channelId, 100, '0xBob'), /Signature is required/);

  // Forged signature
  const candidate = { channelId, sequence: 1, balanceA: 400, balanceB: 600, signatures: [] };
  const forgedSig = manager.signState(candidate, attackerKey.privateKey);
  assert.throws(
    () => manager.updateState(channelId, 100, '0xBob', forgedSig, pubA),
    /Invalid signature/
  );
});

// 7. Cooperative Channel Settlement
test('closeChannel settles cooperatively when dual valid signatures are provided', () => {
  const manager = new StateChannelManager();
  const channelId = 'coop-01';
  manager.createChannelState(channelId, '0xAlice', '0xBob', 800, 200);

  const keyA = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubA = keyA.publicKey.export({ type: 'spki', format: 'pem' });
  const keyB = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubB = keyB.publicKey.export({ type: 'spki', format: 'pem' });

  const finalState = { channelId, sequence: 5, balanceA: 500, balanceB: 500, signatures: [] };
  const sigA = manager.signState(finalState, keyA.privateKey);
  const sigB = manager.signState(finalState, keyB.privateKey);

  const result = manager.closeChannel(channelId, {
    finalBalanceA: 500,
    finalBalanceB: 500,
    finalSequence: 5,
    sigA,
    sigB,
    pubKeyA: pubA,
    pubKeyB: pubB
  });

  assert.strictEqual(result.settlementType, 'cooperative');
  assert.strictEqual(result.finalBalanceA, 500);
  assert.strictEqual(result.finalBalanceB, 500);
  assert.strictEqual(result.sequence, 5);

  const closedState = manager.getChannelState(channelId);
  assert.strictEqual(closedState.status, 'closed');

  // Cannot update closed channel
  assert.throws(() => manager.updateState(channelId, 10, '0xBob', sigA, pubA), /is closed and cannot be updated/);
});

// 8. Unilateral Dispute Challenge Mechanism
test('initiateDispute and counterDispute correctly manage dispute lifecycle and challenge window', () => {
  const manager = new StateChannelManager();
  const channelId = 'dispute-01';
  manager.createChannelState(channelId, '0xAlice', '0xBob', 600, 400);

  const keyA = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubA = keyA.publicKey.export({ type: 'spki', format: 'pem' });
  const keyB = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubB = keyB.publicKey.export({ type: 'spki', format: 'pem' });

  // Alice submits sequence 2 as dispute
  const stateSeq2 = { channelId, sequence: 2, balanceA: 400, balanceB: 600, signatures: [] };
  const sig2 = manager.signState(stateSeq2, keyA.privateKey);
  const dispute = manager.initiateDispute(channelId, stateSeq2, sig2, pubA);

  assert.strictEqual(dispute.sequence, 2);
  assert.strictEqual(dispute.balanceA, 400);
  assert.strictEqual(dispute.balanceB, 600);

  const chanState = manager.getChannelState(channelId);
  assert.strictEqual(chanState.status, 'disputed');

  // Bob presents strictly higher state seq 4 (counter-dispute)
  const stateSeq4 = { channelId, sequence: 4, balanceA: 300, balanceB: 700, signatures: [] };
  const sig4 = manager.signState(stateSeq4, keyB.privateKey);
  const updatedDispute = manager.counterDispute(channelId, stateSeq4, sig4, pubB);

  assert.strictEqual(updatedDispute.sequence, 4);
  assert.strictEqual(updatedDispute.balanceA, 300);
  assert.strictEqual(updatedDispute.balanceB, 700);

  // Counter-dispute with equal or lower sequence must be rejected
  const staleDispute = { channelId, sequence: 3, balanceA: 350, balanceB: 650, signatures: [] };
  const sig3 = manager.signState(staleDispute, keyA.privateKey);
  assert.throws(
    () => manager.counterDispute(channelId, staleDispute, sig3, pubA),
    /must be strictly greater than active dispute sequence/
  );

  // Unilateral settlement before timeout expires must be rejected
  assert.throws(() => manager.closeChannel(channelId), /Cannot settle disputed channel before challenge timeout/);

  // Fast-forward challenge timeout for testing settlement
  chanState.dispute.expiresAt = Date.now() - 1000;
  const settlement = manager.closeChannel(channelId);
  assert.strictEqual(settlement.settlementType, 'unilateral_dispute_settled');
  assert.strictEqual(settlement.finalBalanceA, 300);
  assert.strictEqual(settlement.finalBalanceB, 700);
  assert.strictEqual(settlement.sequence, 4);
});

console.log(`\n🎉 All ${passedTests} Comprehensive State Channel Manager unit tests passed successfully!`);
process.exit(0);
