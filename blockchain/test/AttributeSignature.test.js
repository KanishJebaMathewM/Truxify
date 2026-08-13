import assert from "node:assert/strict";
import hre from "hardhat";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

describe("AttributeSignature ABS Verification", function () {
  async function deploy() {
    const AttributeSignature = await ethers.getContractFactory("AttributeSignature");
    const absContract = await AttributeSignature.deploy();
    await absContract.waitForDeployment();
    return { absContract };
  }

  it("rejects arbitrary non-zero signatures (issue #10804)", async function () {
    const { absContract } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true AND Driver.experience >= 3";

    // 64-byte mock signature carrying non-zero values; must NOT be accepted.
    const mockSignature = ethers.concat([
      ethers.toBeHex(1, 32),
      ethers.toBeHex(2, 32)
    ]);

    const isValid = await absContract.verifyAttributeSignature.staticCall(manifestHash, policy, mockSignature);
    assert.equal(isValid, false);
  });

  it("rejects signatures that are too short (issue #10804)", async function () {
    const { absContract } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true AND Driver.experience >= 3";

    await assertRejectsWith(
      absContract.verifyAttributeSignature.staticCall(manifestHash, policy, ethers.toBeHex(1, 32)),
      "Invalid signature dimensions for ABS pairing"
    );
  });
});
