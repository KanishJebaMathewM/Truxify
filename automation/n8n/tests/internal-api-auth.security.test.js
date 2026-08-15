"use strict";

/**
 * Security audit for n8n calls into the internal control plane (#13925).
 *
 * `/api/internal/*` is mounted behind `requireApiKey` in backend/api/src/index.js
 * and fronts privileged actions — opening the escrow circuit breaker, refilling
 * the relayer gas tank. A node that omits the `httpHeaderAuth` credential does
 * not "call the endpoint anonymously"; the API rejects it with 401, so the
 * automation silently never fires. For the security sentinel that means the
 * flash-loan defensive pause is dead code: a control that appears wired up in
 * the workflow graph and does nothing at runtime.
 *
 * This is a repo-wide invariant rather than a single-workflow check, because the
 * regression is invisible in review — the node looks complete without the
 * credential block, and there is no error until an incident.
 *
 * Run: node automation/n8n/tests/internal-api-auth.security.test.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WORKFLOW_DIR = path.join(__dirname, "..", "workflows");
const HTTP_TYPE = "n8n-nodes-base.httpRequest";
const INTERNAL_PREFIX = "/api/internal";
const EXPECTED_CREDENTIAL = "Truxify Internal API Key";

/** @returns {{file: string, workflow: object}[]} every workflow JSON in the repo. */
function loadWorkflows() {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: f, workflow: require(path.join(WORKFLOW_DIR, f)) }));
}

/** Every httpRequest node in the repo whose URL targets /api/internal. */
function internalApiNodes() {
  const found = [];
  for (const { file, workflow } of loadWorkflows()) {
    for (const node of workflow.nodes || []) {
      if (node.type !== HTTP_TYPE) continue;
      const url = (node.parameters || {}).url;
      if (typeof url === "string" && url.includes(INTERNAL_PREFIX)) {
        found.push({ file, node });
      }
    }
  }
  return found;
}

let failures = 0;

/**
 * Runs one assertion block, recording rather than throwing on failure so a
 * single run reports every violation instead of stopping at the first.
 *
 * @param {string} title
 * @param {() => void} fn
 */
function test(title, fn) {
  try {
    fn();
    console.log(`PASS: ${title}`);
  } catch (err) {
    failures++;
    console.error(`FAILED: ${title}\n  ${err.message}`);
  }
}

const nodes = internalApiNodes();

test("the audit actually found internal-API nodes to check", () => {
  assert.ok(
    nodes.length > 0,
    "no httpRequest node targets /api/internal — the URL shape changed and this audit is no longer guarding anything",
  );
});

test("every /api/internal node declares generic header authentication", () => {
  for (const { file, node } of nodes) {
    const params = node.parameters || {};
    assert.strictEqual(
      params.authentication,
      "genericCredentialType",
      `${file}: node "${node.name}" (${params.url}) has authentication=${
        params.authentication ?? "unset"
      }; /api/internal is behind requireApiKey, so this call is rejected with 401`,
    );
    assert.strictEqual(
      params.genericAuthType,
      "httpHeaderAuth",
      `${file}: node "${node.name}" must use httpHeaderAuth (the x-api-key header requireApiKey reads)`,
    );
  }
});

test("every /api/internal node attaches the shared internal API key credential", () => {
  for (const { file, node } of nodes) {
    const cred = (node.credentials || {}).httpHeaderAuth;
    assert.ok(
      cred,
      `${file}: node "${node.name}" declares header auth but attaches no httpHeaderAuth credential`,
    );
    assert.strictEqual(
      cred.name,
      EXPECTED_CREDENTIAL,
      `${file}: node "${node.name}" must reference the "${EXPECTED_CREDENTIAL}" credential, got "${cred.name}"`,
    );
  }
});

// ─── Sentinel-specific: the pause node is the whole point of the workflow ─────

test("the security sentinel still routes its detection to a defensive pause", () => {
  const sentinel = require(path.join(WORKFLOW_DIR, "sentinel_security.json"));
  const pause = (sentinel.nodes || []).find(
    (n) => n.name === "Trigger Frontrun Defensive Pause",
  );
  assert.ok(pause, "sentinel_security.json lost its defensive pause node");
  assert.strictEqual(
    pause.parameters.url,
    "http://api:5000/api/internal/defensive-pause",
    "the defensive pause must POST to the internal defensive-pause endpoint",
  );
  assert.strictEqual(
    pause.parameters.method,
    "POST",
    "defensive pause is a state change and must be a POST",
  );

  const targets = (sentinel.connections["Is Flash Loan Pattern?"] || {}).main || [];
  const wired = targets.flat().some((c) => c.node === "Trigger Frontrun Defensive Pause");
  assert.ok(wired, "the flash-loan detector is no longer wired to the pause node");
});

test("the defensive pause forwards detector context for incident tracing", () => {
  const sentinel = require(path.join(WORKFLOW_DIR, "sentinel_security.json"));
  const pause = (sentinel.nodes || []).find(
    (n) => n.name === "Trigger Frontrun Defensive Pause",
  );
  const params = pause.parameters || {};

  assert.strictEqual(
    params.sendBody,
    true,
    "the pause node must send a body — without it the DEFENSIVE_PAUSE_TRIGGERED audit event records reason=null, txHash=null and an incident cannot be traced to a transaction",
  );

  const sent = ((params.bodyParametersUi || {}).parameter || []).map((p) => p.name);
  for (const field of ["reason", "txHash"]) {
    assert.ok(sent.includes(field), `the pause node must send "${field}"`);
  }
});

console.log(
  `\n${nodes.length} internal-API node(s) audited across ${loadWorkflows().length} workflow(s).`,
);

if (failures > 0) {
  console.error(`\n${failures} security assertion(s) failed.`);
  process.exit(1);
}
console.log("All internal-API automation calls are authenticated.");
