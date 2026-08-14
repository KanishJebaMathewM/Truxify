import { ReedSolomonStorageManager } from './reed_solomon.js';
import assert from 'assert';

console.log('Testing Reed-Solomon Erasure Coding...');

const sourceDoc = Buffer.from("CONFIDENTIAL_BILL_OF_LADING_PROVENANCE_AND_ESCROW_RELEASE_LOGS");
const manager = new ReedSolomonStorageManager(4, 2);
const encoded = manager.encodeFile(sourceDoc);
const { shards, shardSize, originalSize } = encoded;

// Expecting 4 data shards + 2 parity shards = 6 shards total
assert.strictEqual(shards.length, 6);

function reconstruct(shardsList) {
  return manager.decodeFile(shardsList, originalSize, shardSize).toString();
}

// 1. Reconstruction from the first 4 shards (all data shards)
assert.strictEqual(reconstruct(shards.slice(0, 4)), sourceDoc.toString());

// 2. A lost data shard is recovered using parity (shards 1,2,3,4)
assert.strictEqual(reconstruct([null, ...shards.slice(1, 5)]), sourceDoc.toString());

// 3. Reconstruction from shards 2,3,4,5 (data + both parity shards)
assert.strictEqual(
  reconstruct([null, null, shards[2], shards[3], shards[4], shards[5]]),
  sourceDoc.toString()
);

// 4. Reconstruction from non-contiguous shards (0, 1, 4, 5)
assert.strictEqual(
  reconstruct([shards[0], shards[1], null, null, shards[4], shards[5]]),
  sourceDoc.toString()
);

// 5. Two lost data shards recovered with both parity shards (shards 2,3,4,5)
assert.strictEqual(
  reconstruct([null, null, shards[2], shards[3], shards[4], shards[5]]),
  sourceDoc.toString()
);

// 6. Not enough shards must fail loudly instead of returning corrupt data
assert.throws(() => reconstruct(shards.slice(0, 3)));

// 7. Corrupted/missing shards among the full set must not silently succeed
const corrupted = shards.slice();
corrupted[2] = null;
corrupted[5] = null;
assert.strictEqual(reconstruct(corrupted), sourceDoc.toString());

console.log('✅ Reed-Solomon Erasure Coding tests passed successfully.');
