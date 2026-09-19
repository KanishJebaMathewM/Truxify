const assert = require('assert');
const fs = require('fs');
const path = require('path');

const workflow = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'workflows', 'circuit_breaker.json'),
  'utf8',
));

const localPause = workflow.nodes.find((node) => node.name === 'Execute Emergency Pause');
const onChainPause = workflow.nodes.find((node) => node.name === 'Pause Escrow Contract On-Chain');

assert.strictEqual(localPause.parameters.url, 'http://api:5000/api/internal/pause-escrow');
assert.strictEqual(onChainPause.parameters.url, 'http://api:5000/api/internal/pause-escrow-onchain');
assert.strictEqual(onChainPause.parameters.method, 'POST');
assert.strictEqual(onChainPause.credentials.httpHeaderAuth.name, 'Truxify Internal API Key');

const nextNode = workflow.connections['Execute Emergency Pause'].main[0][0];
assert.strictEqual(nextNode.node, 'Pause Escrow Contract On-Chain');

console.log('Circuit-breaker workflow verifies backend and on-chain pause steps.');