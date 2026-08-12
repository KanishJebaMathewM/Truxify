import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import hre from "hardhat";
import { Interface } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(
  resolve(__dirname, "../../backend/zkid/zkid.service.js"),
  "utf8"
);

function extractServiceSignatures(source) {
  const match = source.match(/this\.zkidABI = \[([\s\S]*?)\];/);
  assert.ok(match, "zkidABI array not found in zkid.service.js");
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("ZKID service / ZKIdentity contract ABI conformance", function () {
  it("every function selector the service calls exists on the deployed contract", async function () {
    const artifact = await hre.artifacts.readArtifact("ZKIdentity");
    const contractInterface = new Interface(artifact.abi);

    const serviceSignatures = extractServiceSignatures(serviceSource);
    assert.ok(serviceSignatures.length > 0, "no ABI signatures found in zkid.service.js");

    const serviceInterface = new Interface(serviceSignatures);
    for (const fragment of serviceInterface.fragments) {
      if (fragment.type !== 'function') continue;
      const matching = contractInterface.getFunction(fragment.selector);
      assert.ok(
        matching,
        `zkid.service.js calls '${fragment.format()}' but ZKIdentity.sol does not implement it`
      );
    }
  });
});
