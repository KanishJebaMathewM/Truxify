import { atomicSwapRelayer, AtomicSwapRelayer } from './swap_relayer.js';
import assert from 'assert';
import { ethers } from 'ethers';

console.log('--- Running Atomic Swap Relayer & Security Guard Unit Tests ---');

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

// 1. Instantiation and default parameter bounds
test('AtomicSwapRelayer should initialize with standard safety boundaries', () => {
  const relayer = new AtomicSwapRelayer();
  assert.strictEqual(relayer.MIN_LOCK_DURATION, 3600);
  assert.strictEqual(relayer.MAX_LOCK_DURATION, 2592000);
  assert.strictEqual(relayer.MIN_CROSS_CHAIN_DELTA, 3600);
  assert.strictEqual(relayer.MAX_SWAP_AMOUNT, 1000000);
});

// 2. Secret and hashlock generation
test('generateHashLockSecret should produce 32-byte secret and matching keccak256 hash', () => {
  const { secretHex, secretBytes, hashLock, algorithm } = atomicSwapRelayer.generateHashLockSecret('keccak256');
  assert.strictEqual(algorithm, 'keccak256');
  assert.strictEqual(typeof secretHex, 'string');
  assert.strictEqual(secretHex.startsWith('0x'), true);
  assert.strictEqual(secretHex.length, 66); // '0x' + 64 hex chars
  assert.strictEqual(secretBytes.length, 32);
  assert.strictEqual(typeof hashLock, 'string');
  assert.strictEqual(hashLock.startsWith('0x'), true);
  assert.strictEqual(hashLock.length, 66);

  // Verify preimage directly
  const computed = ethers.keccak256(secretBytes);
  assert.strictEqual(computed.toLowerCase(), hashLock.toLowerCase());
});

test('generateHashLockSecret should support sha256 for cross-chain non-EVM interop', () => {
  const { secretHex, secretBytes, hashLock, algorithm } = atomicSwapRelayer.generateHashLockSecret('sha256');
  assert.strictEqual(algorithm, 'sha256');
  assert.strictEqual(secretHex.length, 66);
  assert.strictEqual(secretBytes.length, 32);

  const computed = ethers.sha256(secretBytes);
  assert.strictEqual(computed.toLowerCase(), hashLock.toLowerCase());
});

// 3. Preimage hashing variations
test('hashPreimage should handle 0x-prefixed hex, unprefixed hex, Buffers, and strings', () => {
  const secretHex = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const unprefixed = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const buf = Buffer.from(unprefixed, 'hex');

  const hashFromHex = atomicSwapRelayer.hashPreimage(secretHex, 'keccak256');
  const hashFromUnprefixed = atomicSwapRelayer.hashPreimage(unprefixed, 'keccak256');
  const hashFromBuf = atomicSwapRelayer.hashPreimage(buf, 'keccak256');

  assert.strictEqual(hashFromHex, hashFromUnprefixed);
  assert.strictEqual(hashFromHex, hashFromBuf);
});

test('hashPreimage should reject entropy lower than 16 bytes', () => {
  const weakSecret = '0x123456';
  assert.throws(() => {
    atomicSwapRelayer.hashPreimage(weakSecret);
  }, /Preimage entropy too low/);
});

test('hashPreimage should reject unsupported algorithms', () => {
  const validSecret = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  assert.throws(() => {
    atomicSwapRelayer.hashPreimage(validSecret, 'md5');
  }, /Unsupported hashlock algorithm/);
});

test('hashPreimage should reject null, undefined, or empty secrets', () => {
  assert.throws(() => atomicSwapRelayer.hashPreimage(null), /cannot be null or empty/);
  assert.throws(() => atomicSwapRelayer.hashPreimage(''), /cannot be null or empty/);
});

// 4. Constant-time preimage verification
test('verifyPreimage should return true for matching secrets (case-insensitive)', () => {
  const secret = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const hashLock = ethers.keccak256(secret);

  assert.strictEqual(atomicSwapRelayer.verifyPreimage(secret, hashLock), true);
  assert.strictEqual(atomicSwapRelayer.verifyPreimage(secret.toUpperCase(), hashLock), true);
  assert.strictEqual(atomicSwapRelayer.verifyPreimage(secret, hashLock.toUpperCase()), true);
});

test('verifyPreimage should return false for mismatched secrets or invalid hashlocks', () => {
  const secretA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const secretB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const hashLockA = ethers.keccak256(secretA);

  assert.strictEqual(atomicSwapRelayer.verifyPreimage(secretB, hashLockA), false);
  assert.strictEqual(atomicSwapRelayer.verifyPreimage('0xinvalid', hashLockA), false);
  assert.strictEqual(atomicSwapRelayer.verifyPreimage(secretA, '0xdeadbeef'), false);
  assert.strictEqual(atomicSwapRelayer.verifyPreimage(null, hashLockA), false);
  assert.strictEqual(atomicSwapRelayer.verifyPreimage(secretA, null), false);
});

// 5. Timelock bounds validation
test('validateTimelock should accept durations within minimum and maximum boundaries', () => {
  const oneDay = 86400;
  const result = atomicSwapRelayer.validateTimelock(oneDay);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.duration, 86400);

  const minResult = atomicSwapRelayer.validateTimelock(3600);
  assert.strictEqual(minResult.valid, true);
});

test('validateTimelock should reject durations below safety threshold or above maximum horizon', () => {
  const tooShort = atomicSwapRelayer.validateTimelock(1800); // 30 min < 1 hour
  assert.strictEqual(tooShort.valid, false);
  assert.match(tooShort.error, /below minimum safety threshold/);

  const tooLong = atomicSwapRelayer.validateTimelock(3000000); // > 30 days
  assert.strictEqual(tooLong.valid, false);
  assert.match(tooLong.error, /exceeds maximum allowed horizon/);

  const invalidType = atomicSwapRelayer.validateTimelock('not-a-number');
  assert.strictEqual(invalidType.valid, false);
  assert.match(invalidType.error, /positive integer/);
});

// 6. Cross-chain timelock safety delta
test('validateCrossChainTimelocks should enforce safe lock duration hierarchy between chains', () => {
  // Initiator on Polygon (chain A) locks for 48 hours (172800s)
  // Participant on Arbitrum (chain B) locks for 24 hours (86400s)
  // Delta = 24 hours (86400s) > 3600s
  const safeCheck = atomicSwapRelayer.validateCrossChainTimelocks(172800, 86400, 3600);
  assert.strictEqual(safeCheck.safe, true);
  assert.strictEqual(safeCheck.delta, 86400);

  // Unsafe: Initiator locks for equal duration or less
  const unsafeCheck = atomicSwapRelayer.validateCrossChainTimelocks(86400, 86400, 3600);
  assert.strictEqual(unsafeCheck.safe, false);
  assert.strictEqual(unsafeCheck.delta, 0);
  assert.match(unsafeCheck.error, /initiator lock duration must exceed counterparty/);

  const invertedCheck = atomicSwapRelayer.validateCrossChainTimelocks(40000, 86400, 3600);
  assert.strictEqual(invertedCheck.safe, false);
  assert.strictEqual(invertedCheck.delta < 0, true);
});

// 7. Participant EVM address validation
test('validateParticipantAddress should validate checksummed and reject zero addresses or malformed strings', () => {
  const sampleWallet = ethers.Wallet.createRandom();
  const validAddr = sampleWallet.address;
  const validated = atomicSwapRelayer.validateParticipantAddress(validAddr.toLowerCase(), 'Counterparty');
  assert.strictEqual(validated, validAddr);

  assert.throws(() => {
    atomicSwapRelayer.validateParticipantAddress(ethers.ZeroAddress, 'Counterparty');
  }, /cannot be the Zero Address/);

  assert.throws(() => {
    atomicSwapRelayer.validateParticipantAddress('not-an-address', 'Counterparty');
  }, /not a valid EVM address format/);

  assert.throws(() => {
    atomicSwapRelayer.validateParticipantAddress('', 'Counterparty');
  }, /must be a non-empty string/);
});

// 8. Amount validation
test('validateAmount should enforce positive bounds and maximum swap caps', () => {
  const validAmount = atomicSwapRelayer.validateAmount(50.5);
  assert.strictEqual(validAmount.valid, true);
  assert.strictEqual(validAmount.parsed, 50.5);

  const zeroAmount = atomicSwapRelayer.validateAmount(0);
  assert.strictEqual(zeroAmount.valid, false);

  const negativeAmount = atomicSwapRelayer.validateAmount(-10);
  assert.strictEqual(negativeAmount.valid, false);

  const excessiveAmount = atomicSwapRelayer.validateAmount(2000000); // Exceeds 1,000,000 max
  assert.strictEqual(excessiveAmount.valid, false);
  assert.match(excessiveAmount.error, /exceeds maximum safety limit/);
});

// 9. Swap lifecycle state transitions
test('validateStateTransition should enforce strict claim and refund lifecycle boundaries', () => {
  const now = 1700000000;
  const futureLockTime = now + 7200; // 2 hours in the future
  const pastLockTime = now - 3600;   // 1 hour in the past

  // Claim when pending and unexpired -> Allowed
  const claimValid = atomicSwapRelayer.validateStateTransition('pending', 'claim', {
    now,
    lockTimestamp: futureLockTime
  });
  assert.strictEqual(claimValid.allowed, true);

  // Claim when pending and already expired -> Rejected
  const claimExpired = atomicSwapRelayer.validateStateTransition('pending', 'claim', {
    now,
    lockTimestamp: pastLockTime
  });
  assert.strictEqual(claimExpired.allowed, false);
  assert.match(claimExpired.reason, /timelock has expired/);

  // Refund when pending and not yet expired -> Rejected
  const refundPremature = atomicSwapRelayer.validateStateTransition('pending', 'refund', {
    now,
    lockTimestamp: futureLockTime
  });
  assert.strictEqual(refundPremature.allowed, false);
  assert.match(refundPremature.reason, /timelock has not expired yet/);

  // Refund when pending and expired -> Allowed
  const refundValid = atomicSwapRelayer.validateStateTransition('pending', 'refund', {
    now,
    lockTimestamp: pastLockTime
  });
  assert.strictEqual(refundValid.allowed, true);

  // Cannot transition already executed or refunded swaps
  const doubleClaim = atomicSwapRelayer.validateStateTransition('claimed', 'claim', { now, lockTimestamp: futureLockTime });
  assert.strictEqual(doubleClaim.allowed, false);

  const refundClaimed = atomicSwapRelayer.validateStateTransition('claimed', 'refund', { now, lockTimestamp: pastLockTime });
  assert.strictEqual(refundClaimed.allowed, false);
});

// 10. Canonical Swap ID calculation
test('computeCanonicalSwapId should compute deterministic 32-byte hashes', () => {
  const sender = '0x1111111111111111111111111111111111111111';
  const recipient = '0x2222222222222222222222222222222222222222';
  const token = ethers.ZeroAddress;
  const amount = '10.5';
  const hashLock = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const lockDuration = 86400;
  const chainId = 137;

  const id1 = atomicSwapRelayer.computeCanonicalSwapId(sender, recipient, token, amount, hashLock, lockDuration, chainId);
  const id2 = atomicSwapRelayer.computeCanonicalSwapId(sender, recipient, token, amount, hashLock, lockDuration, chainId);

  assert.strictEqual(id1, id2);
  assert.strictEqual(id1.startsWith('0x'), true);
  assert.strictEqual(id1.length, 66);

  // Changing any parameter alters the swap ID
  const idAltered = atomicSwapRelayer.computeCanonicalSwapId(sender, recipient, token, '10.6', hashLock, lockDuration, chainId);
  assert.notStrictEqual(id1, idAltered);
});

console.log(`\n🎉 All ${passedTests} Atomic Swap Relayer unit tests passed successfully!`);
process.exit(0);
