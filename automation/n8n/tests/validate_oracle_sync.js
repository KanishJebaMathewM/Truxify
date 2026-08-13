/**
 * Regression check for oracle_sync.json "Compute Idempotency & Format" node (issue #11552).
 *
 * n8n has no built-in unit-test framework, so this script extracts the EXACT jsCode
 * from the workflow file and executes it against the fixtures in oracle_sync.fixtures.json.
 * It asserts that an invalid/missing JSON-RPC `result` never produces a NaN `gasGwei`
 * and is instead flagged via the `error`/`valid:false` fields.
 *
 * Run: node automation/n8n/tests/validate_oracle_sync.js
 */
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', 'workflows', 'oracle_sync.json');
const fixturesPath = path.join(__dirname, 'oracle_sync.fixtures.json');

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const { fixtures } = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

const codeNode = workflow.nodes.find((n) => n.name === 'Compute Idempotency & Format');
if (!codeNode) {
  throw new Error('Could not find "Compute Idempotency & Format" node in oracle_sync.json');
}

// Wrap the node's jsCode in an IIFE so its top-level `return` resolves to the node output.
const runNode = new Function('items', `return (function(){ ${codeNode.parameters.jsCode} })();`);

let failures = 0;

for (const fixture of fixtures) {
  const output = runNode([{ json: fixture.input }]);
  const out = output[0] && output[0].json;

  if (!out) {
    console.error(`FAIL [${fixture.name}] node returned no item`);
    failures++;
    continue;
  }

  // Hard rule from the issue: gasGwei must never be NaN.
  if (Object.prototype.hasOwnProperty.call(out, 'gasGwei') && !Number.isFinite(out.gasGwei)) {
    console.error(`FAIL [${fixture.name}] emitted non-finite gasGwei: ${out.gasGwei}`);
    failures++;
    continue;
  }

  const isInvalid = fixture.expect === 'invalid';
  if (isInvalid && out.valid !== false) {
    console.error(`FAIL [${fixture.name}] expected invalid result but got valid=${out.valid}`);
    failures++;
    continue;
  }
  if (!isInvalid && out.valid !== true) {
    console.error(`FAIL [${fixture.name}] expected valid result but got valid=${out.valid}`);
    failures++;
    continue;
  }

  console.log(`PASS [${fixture.name}] valid=${out.valid}`);
}

if (failures > 0) {
  console.error(`\n${failures} fixture(s) failed.`);
  process.exit(1);
}

console.log('\nAll oracle_sync gas-validation fixtures passed.');
