import { w3cIssuer } from './vc_issuer.js';
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

// Test Status List 2021 check (0x01 = first index is 1, indicating revoked)
const revoked = w3cIssuer.isRevoked('01', 0);
const active = w3cIssuer.isRevoked('00', 0);

assert.strictEqual(revoked, true);
assert.strictEqual(active, false);

console.log('✅ W3C Verifiable Credentials tests passed successfully.');
