import { ringSignatureService } from './ring_sig.js';
import assert from 'assert';

console.log('Testing Ring Signature Service...');

const kp1 = ringSignatureService.generateRingKeyPair();
const kp2 = ringSignatureService.generateRingKeyPair();
const kp3 = ringSignatureService.generateRingKeyPair();
const attacker = ringSignatureService.generateRingKeyPair();

const ring = [kp1.publicKey, kp2.publicKey, kp3.publicKey];
const message = 'FREIGHT_COMMITMENT_100_TONS';
const signature = ringSignatureService.signRingMessage(message, ring, kp1.privateKey);

assert.strictEqual(signature.pubKeys.length, 3);
assert.strictEqual(signature.c.length, 3);
assert.strictEqual(signature.r.length, 3);
assert.strictEqual(typeof signature.keyImage, 'string');

assert.strictEqual(
  ringSignatureService.verifyRingSignature(message, ring, signature),
  true,
  'valid signature by a ring member must verify'
);

assert.strictEqual(
  ringSignatureService.verifyRingSignature('FREIGHT_COMMITMENT_999_TONS', ring, signature),
  false,
  'signature must fail for a different message'
);

assert.strictEqual(
  ringSignatureService.verifyRingSignature(message, [kp1.publicKey, kp2.publicKey, attacker.publicKey], signature),
  false,
  'signature must fail when the ring is altered'
);

const forged = {
  messageHash: ringSignatureService.hashMessage(message),
  keyImage: ringSignatureService.generateKeyImage(ring, attacker.privateKey),
  c: signature.c,
  r: signature.r,
};
assert.strictEqual(
  ringSignatureService.verifyRingSignature(message, ring, forged),
  false,
  'signature forged with a non-ring key image must fail'
);

const tampered = { ...signature, r: [...signature.r.slice(0, 1), '00'.repeat(32), ...signature.r.slice(2)] };
assert.strictEqual(
  ringSignatureService.verifyRingSignature(message, ring, tampered),
  false,
  'tampered r value must fail verification'
);

const signature2 = ringSignatureService.signRingMessage(message, ring, kp2.privateKey);
assert.strictEqual(
  signature.keyImage === signature2.keyImage,
  false,
  'key image must differ for different signers'
);

const signatureAgain = ringSignatureService.signRingMessage(message, ring, kp1.privateKey);
assert.strictEqual(
  signature.keyImage === signatureAgain.keyImage,
  true,
  'key image must be linkable across signatures by the same signer'
);

let signerNotInRingThrew = false;
try {
  ringSignatureService.signRingMessage(message, ring, attacker.privateKey);
} catch (error) {
  signerNotInRingThrew = error.message.includes('does not match');
}
assert.strictEqual(signerNotInRingThrew, true, 'signer not in ring must throw');

console.log('✅ Ring Signature tests passed successfully.');
