"use strict";

const assert = require("assert");
const path = require("path");
const workflow = require(path.join(__dirname, "..", "dispute-resolution.json"));

function nodeByName(name) {
  return workflow.nodes.find((n) => n.name === name);
}

function errorTargets(nodeName) {
  const conn = workflow.connections[nodeName];
  if (!conn || !conn.main) return [];
  const errorOutputs = conn.main[1] || [];
  return errorOutputs.map((t) => t.node);
}

function reachableViaErrorOutputs(startNode, targetNode) {
  const visited = new Set();
  const stack = [startNode];
  while (stack.length) {
    const current = stack.pop();
    if (current === targetNode) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of errorTargets(current)) stack.push(next);
  }
  return false;
}

let failures = 0;
function test(title, fn) {
  try {
    fn();
    console.log(`PASS: ${title}`);
  } catch (err) {
    failures++;
    console.error(`FAILED: ${title}\n  ${err.message}`);
  }
}

test("has a real Release Escrow Payment node (no phantom) with retry + onError", () => {
  const release = nodeByName("Release Escrow Payment");
  assert.ok(release, "Release Escrow Payment node must exist");
  assert.strictEqual(release.retryOnFail, true, "Release Escrow Payment must retry on fail");
  assert.strictEqual(release.onError, "continueErrorOutput", "Release Escrow Payment must continue error output");
});

test("has a Freeze Escrow Payment node with retry + onError", () => {
  const freeze = nodeByName("Freeze Escrow Payment");
  assert.ok(freeze, "Freeze Escrow Payment node must exist");
  assert.strictEqual(freeze.retryOnFail, true, "Freeze Escrow Payment must retry on fail");
  assert.strictEqual(freeze.onError, "continueErrorOutput", "Freeze Escrow Payment must continue error output");
});

test("Verify Escrow Release error output reaches Alert Admin — Escrow Release Failed", () => {
  assert.ok(
    reachableViaErrorOutputs("Verify Escrow Release", "Alert Admin — Escrow Release Failed"),
    "Alert Admin — Escrow Release Failed must be reachable from Verify Escrow Release error path",
  );
});

test("Release Escrow Payment error output reaches Alert Admin — Escrow Release Failed", () => {
  assert.ok(
    reachableViaErrorOutputs("Release Escrow Payment", "Alert Admin — Escrow Release Failed"),
    "Alert Admin — Escrow Release Failed must be reachable from Release Escrow Payment error path",
  );
});

test("every connection source and target references an existing node", () => {
  const nodeNames = new Set(workflow.nodes.map((n) => n.name));
  for (const [source, outputs] of Object.entries(workflow.connections)) {
    assert.ok(nodeNames.has(source), `connection source '${source}' must be a real node`);
    for (const branch of outputs.main || []) {
      for (const edge of branch) {
        assert.ok(nodeNames.has(edge.node), `connection target '${edge.node}' must be a real node`);
      }
    }
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll tests passed");
