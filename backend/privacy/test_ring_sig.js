import { ringSignatureService } from './ring_sig.js';
import assert from 'assert';

console.log('Testing Ring Signature Service...');

const kp1 = ringSignatureService.generateRingKeyPair();
const kp2 = ringSignatureService.generateRingKeyPair();
const kp3 = ringSignatureService.generateRingKeyPair();

const ring = [kp1.publicKey, kp2.publicKey, kp3.publicKey];
const signature = ringSignatureService.signRingMessage('FREIGHT_COMMITMENT_100_TONS', ring, kp1.privateKey);

assert.strictEqual(signature.pubKeys.length, 3);
assert.strictEqual(signature.c.length, 3);
assert.strictEqual(signature.r.length, 3);
assert.strictEqual(typeof signature.keyImage, 'string');

console.log('✅ Ring Signature tests passed successfully.');
