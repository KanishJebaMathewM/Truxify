const fs = require('fs');
const path = require('path');
const assert = require('assert');

const circuitPath = path.join(__dirname, 'kyc_verification.circom');
const circuit = fs.readFileSync(circuitPath, 'utf8');

assert.match(circuit, /include\s+"\.\.\/node_modules\/circomlib\/circuits\/poseidon\.circom";/);
assert.doesNotMatch(circuit, /template\s+Poseidon2\s*\(/);
assert.doesNotMatch(circuit, /template\s+Poseidon4\s*\(/);
assert.match(circuit, /component\s+docHasher\s*=\s*Poseidon\(4\);/);
assert.match(circuit, /component\s+userBinder\s*=\s*Poseidon\(2\);/);
assert.match(circuit, /component\s+hasher\s*=\s*Poseidon\(1\);/);

console.log('✅ Standard Poseidon circuit wiring tests passed.');
