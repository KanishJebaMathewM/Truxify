import { w3cIssuer, W3cCredentialIssuer } from './vc_issuer.js';
import crypto from 'crypto';
import assert from 'assert';

console.log('Testing W3C Verifiable Credentials Engine...');

const driverId = 'DRV_99';
const attrs = {
  name: 'Rajesh Kumar',
  licenseCategory: 'Heavy Vehicle',
  hazmatCertified: true,
};

const vc = w3cIssuer.issueDriverCredential(driverId, attrs);
assert.strictEqual(vc.issuer, 'did:truxify:authority');
assert.strictEqual(vc.credentialSubject.hazmatCertified, true);
assert.strictEqual(vc.proof.type, 'Ed25519Signature2020');
assert.strictEqual(vc.proof.proofValue.length, 128);
assert.strictEqual(w3cIssuer.verifyCredentialProof(vc), true);

// The proof must be an Ed25519 signature, not a SHA-256 digest of the credential.
const credentialWithoutProof = { ...vc };
delete credentialWithoutProof.proof;
const sha256Digest = crypto
  .createHash('sha256')
  .update(JSON.stringify(credentialWithoutProof))
  .digest('hex');
assert.notStrictEqual(vc.proof.proofValue, sha256Digest);

// Any modification to the signed credential must invalidate the proof.
const tamperedVc = JSON.parse(JSON.stringify(vc));
tamperedVc.credentialSubject.hazmatCertified = false;
assert.strictEqual(w3cIssuer.verifyCredentialProof(tamperedVc), false);

// Malformed proof values must be rejected without throwing.
const malformedVc = JSON.parse(JSON.stringify(vc));
malformedVc.proof.proofValue = 'not-a-signature';
assert.strictEqual(w3cIssuer.verifyCredentialProof(malformedVc), false);

// A separate issuer must produce a proof verifiable with its own key.
const separateIssuer = new W3cCredentialIssuer();
const separateVc = separateIssuer.issueDriverCredential(driverId, attrs);
assert.strictEqual(separateIssuer.verifyCredentialProof(separateVc), true);
assert.strictEqual(w3cIssuer.verifyCredentialProof(separateVc), false);

// Test Status List 2021 check (0x01 = first index is 1, indicating revoked)
const revoked = w3cIssuer.isRevoked('01', 0);
const active = w3cIssuer.isRevoked('00', 0);

assert.strictEqual(revoked, true);
assert.strictEqual(active, false);

console.log('✅ W3C Verifiable Credentials tests passed successfully.');
