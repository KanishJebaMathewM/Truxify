
import assert from 'node:assert/strict';
import { W3cCredentialIssuer } from './vc_issuer.js';

const issuer = new W3cCredentialIssuer();

const ERRORS = {
  bitstring:
    /Status-list bitstring must be a non-empty even-length hexadecimal string/,
  index:
    /Status-list index must be a non-negative safe integer/,
  outOfRange:
    /Status-list index is outside the supplied bitstring/,
};

/* -------------------------------------------------------------------------- */
/* Test helpers                                                               */
/* -------------------------------------------------------------------------- */

let passed = 0;

function test(name, callback) {
  try {
    callback();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

function expectRevoked(bitstring, index, expected) {
  assert.equal(
    issuer.isRevoked(bitstring, index),
    expected
  );
}

function expectInvalidBitstring(value) {
  assert.throws(
    () => issuer.isRevoked(value, 0),
    ERRORS.bitstring
  );
}

function expectInvalidIndex(index) {
  assert.throws(
    () => issuer.isRevoked('00', index),
    ERRORS.index
  );
}

/* -------------------------------------------------------------------------- */
/* Basic revocation behavior                                                  */
/* -------------------------------------------------------------------------- */

console.log('\nVC revocation tests');

test('detects a revoked bit', () => {
  expectRevoked('01', 0, true);
});

test('detects an unrevoked bit', () => {
  expectRevoked('00', 0, false);
});

test('detects a revoked second bit', () => {
  expectRevoked('02', 1, true);
});

/* -------------------------------------------------------------------------- */
/* Bit-level boundaries                                                      */
/* -------------------------------------------------------------------------- */

test('checks all eight bits in a byte', () => {
  const bitstring = 'A5';

  const expected = [
    true,  // bit 0
    false, // bit 1
    true,  // bit 2
    false, // bit 3
    false, // bit 4
    true,  // bit 5
    false, // bit 6
    true,  // bit 7
  ];

  expected.forEach((value, index) => {
    expectRevoked(bitstring, index, value);
  });
});

test('checks the highest bit in a byte', () => {
  expectRevoked('80', 7, true);
});

test('checks the lowest bit in a byte', () => {
  expectRevoked('01', 0, true);
});

test('rejects the first bit beyond a one-byte bitstring', () => {
  assert.throws(
    () => issuer.isRevoked('00', 8),
    ERRORS.outOfRange
  );
});

/* -------------------------------------------------------------------------- */
/* Multi-byte behavior                                                        */
/* -------------------------------------------------------------------------- */

test('checks the first bit of the second byte', () => {
  expectRevoked('0001', 8, true);
});

test('checks the last bit of a two-byte bitstring', () => {
  expectRevoked('0080', 15, true);
});

test('does not confuse bits across byte boundaries', () => {
  expectRevoked('0100', 0, true);
  expectRevoked('0100', 8, false);

  expectRevoked('0001', 0, false);
  expectRevoked('0001', 8, true);
});

test('rejects an index beyond a two-byte bitstring', () => {
  assert.throws(
    () => issuer.isRevoked('0000', 16),
    ERRORS.outOfRange
  );
});

/* -------------------------------------------------------------------------- */
/* Hexadecimal validation                                                     */
/* -------------------------------------------------------------------------- */

test('rejects empty bitstrings', () => {
  expectInvalidBitstring('');
});

test('rejects odd-length hexadecimal strings', () => {
  for (const value of ['0', 'abc', '12345']) {
    expectInvalidBitstring(value);
  }
});

test('rejects non-hexadecimal characters', () => {
  for (const value of ['zz', '01g0', '0x01', 'GG', '0Z']) {
    expectInvalidBitstring(value);
  }
});

test('rejects whitespace in bitstrings', () => {
  for (const value of [' 01', '01 ', '01\n', '01 02']) {
    expectInvalidBitstring(value);
  }
});

test('rejects non-string bitstrings', () => {
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
});

test('accepts uppercase hexadecimal', () => {
  expectRevoked('0A', 1, true);
});

test('accepts lowercase hexadecimal', () => {
  expectRevoked('0a', 1, true);
});

/* -------------------------------------------------------------------------- */
/* Index validation                                                           */
/* -------------------------------------------------------------------------- */

test('rejects negative indexes', () => {
  expectInvalidIndex(-1);
});

test('rejects fractional indexes', () => {
  expectInvalidIndex(1.5);
});

test('rejects NaN', () => {
  expectInvalidIndex(Number.NaN);
});

test('rejects infinite indexes', () => {
  expectInvalidIndex(Number.POSITIVE_INFINITY);
  expectInvalidIndex(Number.NEGATIVE_INFINITY);
});

test('rejects unsafe integer indexes', () => {
  expectInvalidIndex(Number.MAX_SAFE_INTEGER + 1);
});

test('rejects string indexes', () => {
  expectInvalidIndex('0');
});

test('rejects null and undefined indexes', () => {
  expectInvalidIndex(null);
  expectInvalidIndex(undefined);
});

test('rejects boolean indexes', () => {
  expectInvalidIndex(true);
  expectInvalidIndex(false);
});

/* -------------------------------------------------------------------------- */
/* Final valid index                                                          */
/* -------------------------------------------------------------------------- */

test('accepts the final valid bit of a nine-byte bitstring', () => {
  expectRevoked('000000000000000080', 64, true);
});

test('returns false for an unset final valid bit', () => {
  expectRevoked('000000000000000000', 64, false);
});

test('rejects the first index beyond the final valid bit', () => {
  assert.throws(
    () => issuer.isRevoked('000000000000000000', 72),
    ERRORS.outOfRange
  );
});

/* -------------------------------------------------------------------------- */
/* Fail-closed regression checks                                              */
/* -------------------------------------------------------------------------- */

test('malformed bitstrings never silently return unrevoked', () => {
  for (const value of ['', 'zz', '0', '01g0', null, undefined]) {
    assert.throws(
      () => issuer.isRevoked(value, 0),
      ERRORS.bitstring
    );
  }
});

test('out-of-range indexes never silently return unrevoked', () => {
  assert.throws(
    () => issuer.isRevoked('00', 8),
    ERRORS.outOfRange
  );
});

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

console.log(`\n✅ ${passed} VC revocation test groups passed.`);
