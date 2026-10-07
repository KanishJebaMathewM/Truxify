"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const workflow = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "workflows", "circuit_breaker.json"),
    "utf8"
  )
);

describe("Circuit Breaker Workflow — Security Checks", () => {
  test("Execute Emergency Pause posts to the correct internal pause-escrow endpoint", () => {
    const localPause = workflow.nodes.find(
      (node) => node.name === "Execute Emergency Pause"
    );
    assert.ok(localPause, "Execute Emergency Pause node must exist");
    assert.strictEqual(
      localPause.parameters.url,
      "http://api:5000/api/internal/pause-escrow"
    );
  });

  test("Pause Escrow Contract On-Chain posts to the correct on-chain pause endpoint", () => {
    const onChainPause = workflow.nodes.find(
      (node) => node.name === "Pause Escrow Contract On-Chain"
    );
    assert.ok(onChainPause, "Pause Escrow Contract On-Chain node must exist");
    assert.strictEqual(
      onChainPause.parameters.url,
      "http://api:5000/api/internal/pause-escrow-onchain"
    );
    assert.strictEqual(onChainPause.parameters.method, "POST");
  });

  test("Pause Escrow Contract On-Chain binds the Truxify Internal API Key credential", () => {
    const onChainPause = workflow.nodes.find(
      (node) => node.name === "Pause Escrow Contract On-Chain"
    );
    assert.ok(onChainPause, "Pause Escrow Contract On-Chain node must exist");
    assert.strictEqual(
      onChainPause.credentials.httpHeaderAuth.name,
      "Truxify Internal API Key"
    );
  });

  test("Execute Emergency Pause is wired directly to Pause Escrow Contract On-Chain", () => {
    const nextNode =
      workflow.connections["Execute Emergency Pause"].main[0][0];
    assert.strictEqual(nextNode.node, "Pause Escrow Contract On-Chain");
  });
});