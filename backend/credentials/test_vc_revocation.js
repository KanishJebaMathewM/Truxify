import assert from 'assert';
import { W3cCredentialIssuer } from './vc_issuer.js';

const issuer = new W3cCredentialIssuer();

assert.strictEqual(issuer.isRevoked('01', 0), true);
assert.strictEqual(issuer.isRevoked('00', 0), false);
assert.strictEqual(issuer.isRevoked('02', 1), true);

for (const value of ['', '0', 'zz', '01g0']) {
  assert.throws(
    () => issuer.isRevoked(value, 0),
    /Status-list bitstring must be a non-empty even-length hexadecimal string/
  );
}

for (const index of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(
    () => issuer.isRevoked('00', index),
    /Status-list index must be a non-negative safe integer/
  );
}

assert.throws(
  () => issuer.isRevoked('00', 8),
  /Status-list index is outside the supplied bitstring/
);

console.log('✅ VC revocation fail-closed tests passed.');
