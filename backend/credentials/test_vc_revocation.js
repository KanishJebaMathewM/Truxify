
import assert from 'node:assert/strict';
import { W3cCredentialIssuer } from './vc_issuer.js';

const issuer = new W3cCredentialIssuer();

const EXPECTED_ERRORS = {
  bitstring:
    /Status-list bitstring must be a non-empty even-length hexadecimal string/,
  index:
    /Status-list index must be a non-negative safe integer/,
  outOfRange:
    /Status-list index is outside the supplied bitstring/,
};

/**
 * Assert that a revocation check returns the expected result.
 */
function expectRevocation(bitstring, index, expected, description) {
  assert.equal(
    issuer.isRevoked(bitstring, index),
    expected,
    description
  );
}

/**
 * Assert that invalid bitstrings fail closed.
 */
function expectInvalidBitstring(value) {
  assert.throws(
    () => issuer.isRevoked(value, 0),
    EXPECTED_ERRORS.bitstring,
    `Expected malformed bitstring to throw: ${String(value)}`
  );
}

/**
 * Assert that invalid indexes are rejected.
 */
function expectInvalidIndex(bitstring, index) {
  assert.throws(
    () => issuer.isRevoked(bitstring, index),
    EXPECTED_ERRORS.index,
    `Expected invalid index to throw: ${String(index)}`
  );
}

/* -------------------------------------------------------------------------- */
/* Basic revocation behavior                                                  */
/* -------------------------------------------------------------------------- */

expectRevocation('01', 0, true, 'Bit 0 should be revoked');
expectRevocation('00', 0, false, 'Bit 0 should not be revoked');
expectRevocation('02', 1, true, 'Bit 1 should be revoked');

/* -------------------------------------------------------------------------- */
/* Hexadecimal validation                                                     */
/* -------------------------------------------------------------------------- */

for (const value of [
  '',
  '0',
  'zz',
  '01g0',
  '0x01',
  ' 01',
  '01 ',
  '01\n',
  '0 ',
  'abc',
  '0G',
]) {
  expectInvalidBitstring(value);
}

// Non-string values must not be accepted as hexadecimal bitstrings.
for (const value of [
  null,
  undefined,
  0,
  1,
  true,
  false,
  {},
  [],
  new String('01'),
]) {
  expectInvalidBitstring(value);
}

/* -------------------------------------------------------------------------- */
/* Hexadecimal case handling                                                  */
/* -------------------------------------------------------------------------- */

expectRevocation('01', 0, true, 'Lowercase hexadecimal should work');
expectRevocation('0A', 1, true, 'Uppercase hexadecimal should work');
expectRevocation('0a', 1, true, 'Lowercase hexadecimal should work');

/* -------------------------------------------------------------------------- */
/* Index validation                                                           */
/* -------------------------------------------------------------------------- */

for (const index of [
  -1,
  -0.1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
  '0',
  null,
  undefined,
  true,
  {},
]) {
  expectInvalidIndex('00', index);
}

/* -------------------------------------------------------------------------- */
/* Bit boundaries                                                             */
/* -------------------------------------------------------------------------- */

// One byte contains eight bits.
expectRevocation('01', 0, true, 'First bit boundary');
expectRevocation('01', 1, false, 'Second bit boundary');
expectRevocation('80', 7, true, 'Last bit in first byte');

// The next bit is outside a one-byte bitstring.
assert.throws(
  () => issuer.isRevoked('00', 8),
  EXPECTED_ERRORS.outOfRange
);

// Two-byte bitstring boundaries.
expectRevocation('0001', 8, true, 'First bit of second byte');
expectRevocation('8000', 15, true, 'Last bit of second byte');

assert.throws(
  () => issuer.isRevoked('0000', 16),
  EXPECTED_ERRORS.outOfRange
);

/* -------------------------------------------------------------------------- */
/* Multi-byte behavior                                                        */
/* -------------------------------------------------------------------------- */

expectRevocation('0100', 0, true, 'First byte, first bit');
expectRevocation('0100', 8, false, 'Second byte, first bit');
expectRevocation('0001', 8, true, 'Second byte, ninth bit');

/* -------------------------------------------------------------------------- */
/* Maximum valid index                                                        */
/* -------------------------------------------------------------------------- */

expectRevocation(
  '000000000000000080',
  64,
  true,
  'Last bit in a nine-byte bitstring'
);

expectRevocation(
  '000000000000000000',
  64,
  false,
  'Unset last bit in a nine-byte bitstring'
);

/* -------------------------------------------------------------------------- */
/* Fail-closed regression tests                                               */
/* -------------------------------------------------------------------------- */

// A malformed value must never be interpreted as an unrevoked credential.
for (const value of ['', 'zz', '0', '01g0', null, undefined]) {
  assert.throws(
    () => issuer.isRevoked(value, 0),
    'Invalid status-list data must throw rather than return false'
  );
}

// An out-of-range index must never be interpreted as unrevoked.
assert.throws(
  () => issuer.isRevoked('00', 8),
  EXPECTED_ERRORS.outOfRange
);

console.log('✅ All VC revocation tests passed.');
