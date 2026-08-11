import { atomicSwapRelayer } from './swap_relayer.js';
import assert from 'assert';

console.log('Testing Atomic Swap Relayer...');

const { secretHex, hashLock } = atomicSwapRelayer.generateHashLockSecret();
assert.strictEqual(typeof secretHex, 'string');
assert.strictEqual(typeof hashLock, 'string');

const isValid = atomicSwapRelayer.verifyPreimage(secretHex, hashLock);
assert.strictEqual(isValid, true);

const isInvalid = atomicSwapRelayer.verifyPreimage('0x0000000000000000000000000000000000000000000000000000000000000000', hashLock);
assert.strictEqual(isInvalid, false);

console.log('✅ Atomic Swap Relayer tests passed successfully.');
