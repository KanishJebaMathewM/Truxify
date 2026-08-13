import assert from 'assert';

console.log('Testing SnarkPack Proof Aggregator Inputs...');

const inputs = {
  proofHashes: [12, 15, 20, 25],
  aggregatedCommitment: 72 // 12 + 15 + 20 + 25 = 72
};

const computed = inputs.proofHashes.reduce((a, b) => a + b, 0);
assert.strictEqual(computed, inputs.aggregatedCommitment);

console.log('✅ SnarkPack aggregation verification input test passed.');
