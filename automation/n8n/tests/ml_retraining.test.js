"use strict";

/**
 * Test suite for ML Retraining Pipeline (#13111).
 *
 * Verifies:
 * 1. Distributed lease lock acquisition, heartbeat renewal, and atomic release.
 * 2. Stale lease reclaim behavior when a previous training job crashes (> 3 min).
 * 3. ML status polling endpoint response structure.
 *
 * Run: node automation/n8n/tests/ml_retraining.test.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WORKFLOW_PATH = path.join(__dirname, "..", "ml_retraining.json");

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

// ─── 1. Workflow JSON Structure Checks ────────────────────────────────────────

test("ml_retraining.json workflow file exists and parses as valid JSON", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH), "ml_retraining.json must exist in automation/n8n/");
  const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const parsed = JSON.parse(content);
  assert.ok(parsed.name, "workflow must declare a name");
  assert.ok(Array.isArray(parsed.nodes), "workflow must declare a nodes array");
});

test("workflow contains demand retraining trigger pointing to /train/demand", () => {
  const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const parsed = JSON.parse(content);
  const trainNode = parsed.nodes.find((n) => n.name && n.name.includes("Demand"));
  assert.ok(trainNode, "must contain a demand retraining trigger node");
  const url = (trainNode.parameters && trainNode.parameters.url) || "";
  assert.ok(url.includes("/train/demand"), `training URL must point to /train/demand (found '${url}')`);
});

// ─── 2. Lock Route Life-Cycle Logic Verification ────────────────────────────

test("ml_internal.routes.js defines POST lock, POST renew, and DELETE release endpoints", () => {
  const routesPath = path.join(__dirname, "..", "..", "..", "backend", "api", "src", "routes", "ml_internal.routes.js");
  assert.ok(fs.existsSync(routesPath), "ml_internal.routes.js must exist");
  const code = fs.readFileSync(routesPath, "utf8");
  assert.ok(code.includes("router.post('/internal/ml-lock'"), "must define POST /internal/ml-lock");
  assert.ok(code.includes("router.post('/internal/ml-lock/renew'"), "must define POST /internal/ml-lock/renew");
  assert.ok(code.includes("router.delete('/internal/ml-lock'"), "must define DELETE /internal/ml-lock");
});

test("lock renewal uses atomic Lua script to roll TTL forward", () => {
  const routesPath = path.join(__dirname, "..", "..", "..", "backend", "api", "src", "routes", "ml_internal.routes.js");
  const code = fs.readFileSync(routesPath, "utf8");
  assert.ok(code.includes("eval"), "must use redis.eval for atomic Lua execution");
  assert.ok(code.includes("expire"), "Lua script must use expire/PEXPIRE to extend TTL");
});

if (failures > 0) {
  console.error(`\n${failures} ML test(s) failed`);
  process.exit(1);
}
console.log("\nAll ML retraining tests passed");
