import { rsStorageManager } from './reed_solomon.js';
import assert from 'assert';

console.log('Testing Reed-Solomon Erasure Coding...');

const sourceDoc = Buffer.from("CONFIDENTIAL_BILL_OF_LADING_PROVENANCE_AND_ESCROW_RELEASE_LOGS");
const encoded = rsStorageManager.encodeFile(sourceDoc);

// Expecting 4 data shards + 2 parity shards = 6 shards total
assert.strictEqual(encoded.shards.length, 6);

// Simulate reconstruction from first 4 shards
const reconstructed = rsStorageManager.decodeFile(
  encoded.shards.slice(0, 4),
  encoded.originalSize,
  encoded.shardSize
);

assert.strictEqual(reconstructed.toString(), sourceDoc.toString());
console.log('✅ Reed-Solomon Erasure Coding tests passed successfully.');
