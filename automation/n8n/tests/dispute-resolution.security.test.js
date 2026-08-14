"use strict";

/**
 * Security audit for the Dispute Resolution workflow (#13111).
 *
 * The `dispute-trigger` and `admin-resolution` webhooks front operations that
 * move real escrow funds on-chain (`/api/payments/freeze`, `/api/payments/release`).
 * Two invariants must hold for this workflow to be safe to activate:
 *
 *   1. Neither webhook may be anonymously invocable — n8n must reject a POST
 *      that carries no credential, before any node runs.
 *   2. The escrow payee must never be caller-supplied. TruxifyEscrow's
 *      `releasePayment(uint256 bookingId)` pays `booking.driver`, which is bound
 *      at deposit time by `buildDepositTx(...)`; a `recipient` taken from the
 *      request body is an attacker-controlled address with no legitimate consumer.
 *
 * Run: node automation/n8n/tests/dispute-resolution.security.test.js
 */

const assert = require("assert");
const path = require("path");
const workflow = require(path.join(__dirname, "..", "dispute-resolution.json"));

const WEBHOOK_TYPE = "n8n-nodes-base.webhook";
const HTTP_TYPE = "n8n-nodes-base.httpRequest";

/** Endpoints in this workflow that move escrow funds on-chain. */
const FUND_MOVING_PATHS = ["/api/payments/freeze", "/api/payments/release"];

function nodeByName(name) {
  return workflow.nodes.find((n) => n.name === name);
}

function nodesOfType(type) {
  return workflow.nodes.filter((n) => n.type === type);
}

function bodyParameters(node) {
  const ui = (node.parameters || {}).bodyParametersUi || {};
  return ui.parameter || [];
}

function movesFunds(node) {
  const url = (node.parameters || {}).url || "";
  return FUND_MOVING_PATHS.some((p) => url.includes(p));
}

/** Serialised node, for scanning every expression regardless of nesting. */
function nodeSource(node) {
  return JSON.stringify(node);
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

// ─── 1. Webhooks reject unauthenticated POSTs ────────────────────────────────

test("workflow still exposes the two dispute webhooks", () => {
  const webhooks = nodesOfType(WEBHOOK_TYPE);
  const paths = webhooks.map((n) => n.parameters.path).sort();
  assert.deepStrictEqual(
    paths,
    ["admin-resolution", "dispute-trigger"],
    "expected exactly the dispute-trigger and admin-resolution webhooks",
  );
});

test("every webhook declares an authentication method (no anonymous POSTs)", () => {
  for (const node of nodesOfType(WEBHOOK_TYPE)) {
    const auth = node.parameters.authentication;
    assert.ok(
      auth && auth !== "none",
      `webhook '${node.name}' (path '${node.parameters.path}') has no authentication — ` +
        `anyone who can reach the n8n URL can trigger it`,
    );
  }
});

test("every webhook binds a credential for the auth method it declares", () => {
  const credentialForAuth = {
    headerAuth: "httpHeaderAuth",
    basicAuth: "httpBasicAuth",
    jwtAuth: "jwtAuth",
  };
  for (const node of nodesOfType(WEBHOOK_TYPE)) {
    const auth = node.parameters.authentication;
    const expected = credentialForAuth[auth];
    assert.ok(expected, `webhook '${node.name}' uses unknown auth method '${auth}'`);
    assert.ok(
      node.credentials && node.credentials[expected],
      `webhook '${node.name}' declares '${auth}' but binds no '${expected}' credential — ` +
        `n8n would fail open at import time`,
    );
  }
});

// ─── 2. The escrow payee is never caller-supplied ────────────────────────────

test("Release Escrow Payment does not forward a caller-supplied recipient", () => {
  const release = nodeByName("Release Escrow Payment");
  assert.ok(release, "Release Escrow Payment node must exist");

  const names = bodyParameters(release).map((p) => p.name);
  assert.ok(
    !names.includes("recipient"),
    `Release Escrow Payment sends a 'recipient' body parameter (${names.join(", ")}). ` +
      `releasePayment(bookingId) pays booking.driver, bound at deposit time — ` +
      `a request-supplied recipient can only redirect funds`,
  );
  assert.deepStrictEqual(
    names,
    ["bookingId"],
    "escrow release must be identified by bookingId alone",
  );
});

test("no node anywhere derives a payout address from the request body", () => {
  const forbidden = /\$json\.body\.(recipient|payee|destination|to(?:Address)?|wallet(?:Address)?)\b/;
  for (const node of workflow.nodes) {
    const match = nodeSource(node).match(forbidden);
    assert.ok(
      !match,
      `node '${node.name}' reads a payout address from the request body (${match && match[0]}) — ` +
        `escrow destinations must come from the on-chain booking, not the caller`,
    );
  }
});

// ─── 3. Fund-moving calls authenticate to the backend ────────────────────────

test("every fund-moving HTTP node authenticates to the backend", () => {
  const moving = nodesOfType(HTTP_TYPE).filter(movesFunds);
  assert.ok(moving.length > 0, "expected at least one fund-moving HTTP node");

  for (const node of moving) {
    assert.strictEqual(
      node.parameters.authentication,
      "genericCredentialType",
      `'${node.name}' calls ${node.parameters.url} without authentication — ` +
        `the backend cannot re-authorize an anonymous caller`,
    );
    assert.strictEqual(
      node.parameters.genericAuthType,
      "httpHeaderAuth",
      `'${node.name}' must authenticate with the x-api-key header credential (requireApiKey)`,
    );
    assert.ok(
      node.credentials && node.credentials.httpHeaderAuth,
      `'${node.name}' declares header auth but binds no httpHeaderAuth credential`,
    );
  }
});

// ─── 4. Graph integrity ──────────────────────────────────────────────────────

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
  console.error(`\n${failures} security check(s) failed`);
  process.exit(1);
}
console.log("\nAll security checks passed");
