"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const workflow = require(path.join(__dirname, "..", "dispute-resolution.json"));

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const ALERT_EMAIL_EXPRESSION = "={{$env.ADMIN_ALERT_EMAIL}}";
const LITERAL_EMAIL = /^[^={}\s]+@[^={}\s]+$/;

function emailNodes() {
  return workflow.nodes.filter((n) => n.type === "n8n-nodes-base.emailSend");
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

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

test("no emailSend node hardcodes a literal recipient address", () => {
  const nodes = emailNodes();
  assert.ok(nodes.length > 0, "workflow must contain emailSend nodes");
  for (const node of nodes) {
    const toEmail = node.parameters && node.parameters.toEmail;
    assert.ok(toEmail, `${node.name} must define a recipient`);
    assert.ok(
      !LITERAL_EMAIL.test(toEmail),
      `${node.name} must not hardcode a recipient address (found '${toEmail}')`,
    );
  }
});

test("every alert/escalation email routes to $env.ADMIN_ALERT_EMAIL", () => {
  const expected = [
    "Alert Admin — Escrow Freeze Failed",
    "Email Admin",
    "Alert Admin — Escrow Release Failed",
  ];
  for (const name of expected) {
    const node = nodeByName(name);
    assert.ok(node, `${name} node must exist`);
    assert.strictEqual(
      node.parameters.toEmail,
      ALERT_EMAIL_EXPRESSION,
      `${name} must resolve its recipient from ADMIN_ALERT_EMAIL`,
    );
  }
  assert.strictEqual(
    emailNodes().length,
    expected.length,
    "a new emailSend node was added without being covered by this test",
  );
});

test("ADMIN_ALERT_EMAIL is plumbed into the n8n container and documented", () => {
  assert.match(
    readRepoFile("docker-compose.yml"),
    /ADMIN_ALERT_EMAIL=\$\{ADMIN_ALERT_EMAIL:-/,
    "dev compose must pass ADMIN_ALERT_EMAIL to n8n with a fallback",
  );
  assert.match(
    readRepoFile("docker-compose.prod.yml"),
    /ADMIN_ALERT_EMAIL:\s*\$\{ADMIN_ALERT_EMAIL:\?/,
    "prod compose must require ADMIN_ALERT_EMAIL (:? form) so alerts cannot be misrouted",
  );
  // Must ship EMPTY: docker compose interpolates from .env, so any default here
  // would satisfy the prod `:?` guard and re-route alerts to a placeholder.
  assert.match(
    readRepoFile(".env.example"),
    /^ADMIN_ALERT_EMAIL=\s*$/m,
    ".env.example must declare ADMIN_ALERT_EMAIL with no default value",
  );
  assert.match(
    readRepoFile(path.join("automation", "n8n", "README.md")),
    /ADMIN_ALERT_EMAIL/,
    "n8n README env table must document ADMIN_ALERT_EMAIL",
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll tests passed");
