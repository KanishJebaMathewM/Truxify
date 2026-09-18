import { ReedSolomonStorageManager, gmul, gdiv, ginv, gpow, invertSquareMatrix } from './reed_solomon.js';
import assert from 'assert';

console.log('Running Reed-Solomon & GF(256) Arithmetic Test Suite...\n');

// ── 1. Galois Field GF(2^8) Arithmetic Tests ─────────────────────────────────

console.log('1. Testing GF(256) field arithmetic...');

// Identity & Zero Properties
for (let i = 0; i < 256; i++) {
  assert.strictEqual(gmul(0, i), 0, `0 * ${i} must be 0`);
  assert.strictEqual(gmul(i, 0), 0, `${i} * 0 must be 0`);
  assert.strictEqual(gmul(1, i), i, `1 * ${i} must be ${i}`);
  assert.strictEqual(gmul(i, 1), i, `${i} * 1 must be ${i}`);
}

// Multiplicative Inverses
assert.throws(() => ginv(0), /Division by zero/);
assert.throws(() => gdiv(1, 0), /Division by zero/);

for (let i = 1; i < 256; i++) {
  const inv = ginv(i);
  assert.ok(inv >= 1 && inv <= 255, `Inverse of ${i} must be in [1, 255]`);
  assert.strictEqual(gmul(i, inv), 1, `${i} * inv(${i}) must equal 1`);
  assert.strictEqual(gdiv(i, i), 1, `${i} / ${i} must equal 1`);
  assert.strictEqual(gdiv(0, i), 0, `0 / ${i} must equal 0`);
}

// Commutativity & Associativity of Multiplication
for (let a = 1; a < 30; a++) {
  for (let b = 1; b < 30; b++) {
    assert.strictEqual(gmul(a, b), gmul(b, a), `gmul(${a}, ${b}) must be commutative`);
    for (let c = 1; c < 10; c++) {
      assert.strictEqual(
        gmul(gmul(a, b), c),
        gmul(a, gmul(b, c)),
        `gmul(${a}, ${b}, ${c}) must be associative`
      );
    }
  }
}

// Power function with modulo 255 wrapping
for (let i = 1; i < 256; i++) {
  assert.strictEqual(gpow(i, 0), 1, `gpow(${i}, 0) must be 1`);
  assert.strictEqual(gpow(i, 1), i, `gpow(${i}, 1) must be ${i}`);
  assert.strictEqual(gpow(i, 255), 1, `gpow(${i}, 255) must be 1 (Fermat's Little Theorem in GF(2^8))`);
  assert.strictEqual(gpow(i, 510), 1, `gpow(${i}, 510) must wrap modulo 255 to 1`);
}
assert.strictEqual(gpow(0, 5), 0);

console.log('   ✓ GF(256) field arithmetic verified.');

// ── 2. Matrix Inversion Tests ────────────────────────────────────────────────

console.log('2. Testing Matrix Inversion over GF(256)...');

// Identity Matrix Inversion
const id4 = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];
const invId4 = invertSquareMatrix(id4);
assert.deepStrictEqual(invId4, id4, 'Inverse of identity must be identity');

// Arbitrary Invertible Matrix
const mat = [
  [1, 2, 3],
  [2, 4, 7],
  [3, 5, 3],
];
const invMat = invertSquareMatrix(mat);

// Multiply mat * invMat => must equal 3x3 identity
for (let r = 0; r < 3; r++) {
  for (let c = 0; c < 3; c++) {
    let dot = 0;
    for (let k = 0; k < 3; k++) {
      dot ^= gmul(mat[r][k], invMat[k][c]);
    }
    assert.strictEqual(dot, r === c ? 1 : 0, `(mat * invMat)[${r}][${c}] must equal ${r === c ? 1 : 0}`);
  }
}

// Singular Matrix should throw
const singular = [
  [1, 2, 3],
  [1, 2, 3],
  [4, 5, 6],
];
assert.throws(() => invertSquareMatrix(singular), /not invertible/);

console.log('   ✓ Matrix inversion verified.');

// ── 3. Reed-Solomon Storage Manager (4, 2) Standard Tests ────────────────────

console.log('3. Testing ReedSolomonStorageManager (k=4, m=2)...');

const sourceDoc = Buffer.from("CONFIDENTIAL_BILL_OF_LADING_PROVENANCE_AND_ESCROW_RELEASE_LOGS");
const manager42 = new ReedSolomonStorageManager(4, 2);
const encoded42 = manager42.encodeFile(sourceDoc);
const { shards, shardSize, originalSize } = encoded42;

assert.strictEqual(shards.length, 6, 'k=4, m=2 must produce 6 shards');

function reconstruct42(shardsList) {
  return manager42.decodeFile(shardsList, originalSize, shardSize).toString();
}

// All data shards
assert.strictEqual(reconstruct42(shards.slice(0, 4)), sourceDoc.toString());

// 1 lost data shard (shards 1,2,3,4)
assert.strictEqual(reconstruct42([null, ...shards.slice(1, 5)]), sourceDoc.toString());

// 2 lost data shards (shards 2,3,4,5)
assert.strictEqual(
  reconstruct42([null, null, shards[2], shards[3], shards[4], shards[5]]),
  sourceDoc.toString()
);

// Non-contiguous shards (0, 1, 4, 5)
assert.strictEqual(
  reconstruct42([shards[0], shards[1], null, null, shards[4], shards[5]]),
  sourceDoc.toString()
);

// Not enough shards (< k) must throw
assert.throws(() => reconstruct42(shards.slice(0, 3)), /Need at least 4 shards/);

console.log('   ✓ Standard (4, 2) configuration verified.');

// ── 4. Large Payload (10, 4) Multi-Shard Parity & Bounds Overflow Tests ──────

console.log('4. Testing Large Stream (>64KB) with Multi-Shard Parity (k=10, m=4)...');

const manager104 = new ReedSolomonStorageManager(10, 4);
const largeSize = 128 * 1024 + 739; // ~128KB payload
const largeData = Buffer.alloc(largeSize);
for (let i = 0; i < largeSize; i++) {
  largeData[i] = (i * 37 + 13) % 256;
}

const encoded104 = manager104.encodeFile(largeData);
assert.strictEqual(encoded104.shards.length, 14, 'k=10, m=4 must produce 14 shards (10 data + 4 parity)');

// Verify no NaN or undefined bytes in any shard
for (let sIdx = 0; sIdx < encoded104.shards.length; sIdx++) {
  const shard = encoded104.shards[sIdx];
  assert.strictEqual(shard.length, encoded104.shardSize);
  for (let bIdx = 0; bIdx < shard.length; bIdx++) {
    const val = shard[bIdx];
    assert.ok(
      typeof val === 'number' && !Number.isNaN(val) && val >= 0 && val <= 255,
      `Shard ${sIdx} byte ${bIdx} must be a valid uint8 (got ${val})`
    );
  }
}

function reconstruct104(shardsList) {
  return manager104.decodeFile(shardsList, encoded104.originalSize, encoded104.shardSize);
}

// 4.1 All data shards intact
assert.deepStrictEqual(reconstruct104(encoded104.shards.slice(0, 10)), largeData);

// 4.2 Four data shards lost (shards 0, 1, 2, 3 lost; using 4..9 + 4 parity shards 10..13)
const lost0123 = [null, null, null, null, ...encoded104.shards.slice(4)];
assert.deepStrictEqual(reconstruct104(lost0123), largeData);

// 4.3 Alternating lost data shards (0, 2, 4, 6 lost)
const lostAlternating = encoded104.shards.map((s, idx) => [0, 2, 4, 6].includes(idx) ? null : s);
assert.deepStrictEqual(reconstruct104(lostAlternating), largeData);

// 4.4 Lost last 4 data shards (6, 7, 8, 9 lost)
const lost6789 = encoded104.shards.map((s, idx) => [6, 7, 8, 9].includes(idx) ? null : s);
assert.deepStrictEqual(reconstruct104(lost6789), largeData);

// 4.5 Mixed loss (2 data shards 0, 5 and 2 parity shards 10, 11 lost)
const lostMixed = encoded104.shards.map((s, idx) => [0, 5, 10, 11].includes(idx) ? null : s);
assert.deepStrictEqual(reconstruct104(lostMixed), largeData);

// 4.6 All parity shards lost (using only data shards 0..9)
const lostAllParity = [...encoded104.shards.slice(0, 10), null, null, null, null];
assert.deepStrictEqual(reconstruct104(lostAllParity), largeData);

// 4.7 Five shards lost (> m=4) must fail
const lostFive = [null, null, null, null, null, ...encoded104.shards.slice(5)];
assert.throws(() => reconstruct104(lostFive), /Need at least 10 shards/);

console.log('   ✓ Large stream (10, 4) reconstruction verified across all loss patterns.');

// ── 5. Edge Cases & Validation ───────────────────────────────────────────────

console.log('5. Testing Edge Cases & Parameter Validation...');

assert.throws(() => new ReedSolomonStorageManager(0, 2), /k must be an integer/);
assert.throws(() => new ReedSolomonStorageManager(4, 0), /m must be an integer/);
assert.throws(() => new ReedSolomonStorageManager(4.5, 2), /k must be an integer/);
assert.throws(() => new ReedSolomonStorageManager(4, -1), /m must be an integer/);
assert.throws(() => manager42.encodeFile(Buffer.alloc(0)), /Cannot encode an empty file buffer/);
assert.throws(() => manager42.decodeFile([], 100, 25), /requires a non-empty list of shards/);

console.log('   ✓ Parameter validation verified.');

console.log('\n======================================================');
console.log('✅ ALL REED-SOLOMON & GF(256) TESTS PASSED SUCCESSFULLY');
console.log('======================================================\n');
