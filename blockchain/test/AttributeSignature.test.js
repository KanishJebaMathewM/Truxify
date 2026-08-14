import assert from "node:assert/strict";
import hre from "hardhat";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

describe("AttributeSignature ABS Verification", function () {
  async function deploy() {
    const [owner, authority] = await ethers.getSigners();
    const AttributeSignature = await ethers.getContractFactory("AttributeSignature");
    const absContract = await AttributeSignature.deploy();
    await absContract.waitForDeployment();
    return { absContract, owner, authority };
  }

  async function signFor(signer, manifestHash, policy) {
    const inner = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "string"], [manifestHash, policy])
    );
    return signer.signMessage(ethers.getBytes(inner));
  }

  it("verifies a valid signature by a trusted issuer (issue #10796)", async function () {
    const { absContract, owner, authority } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";

    await absContract.connect(owner).setTrustedIssuer(authority.address, true);
    const signature = await signFor(authority, manifestHash, policy);
    const isValid = await absContract.verifyAttributeSignature.staticCall(manifestHash, policy, signature);

    assert.equal(isValid, true);
  });

  it("rejects a signature from an unregistered issuer (issue #10796)", async function () {
    const { absContract, authority } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";

    const signature = await signFor(authority, manifestHash, policy);
    const isValid = await absContract.verifyAttributeSignature.staticCall(manifestHash, policy, signature);

    assert.equal(isValid, false);
  });

  it("rejects an arbitrary non-zero signature blob (issue #10796)", async function () {
    const { absContract } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";

    const arbitrarySignature = ethers.concat([
      ethers.toBeHex(1, 32),
      ethers.toBeHex(2, 32),
      ethers.toBeHex(27, 1),
    ]);

    const isValid = await absContract.verifyAttributeSignature.staticCall(manifestHash, policy, arbitrarySignature);
    assert.equal(isValid, false);
  });

  it("rejects a signature bound to a different policy predicate (issue #10796)", async function () {
    const { absContract, owner, authority } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";

    await absContract.connect(owner).setTrustedIssuer(authority.address, true);
    // Signature is valid for the manifest, but not for this policy.
    const signature = await signFor(authority, manifestHash, "Driver.experience >= 3");

    const isValid = await absContract.verifyAttributeSignature.staticCall(manifestHash, policy, signature);
    assert.equal(isValid, false);
  });

  it("rejects a signature bound to a different manifest hash (issue #10796)", async function () {
    const { absContract, owner, authority } = await deploy();
    const policy = "Driver.hazmat == true";

    await absContract.connect(owner).setTrustedIssuer(authority.address, true);
    const signature = await signFor(authority, ethers.keccak256(ethers.toUtf8Bytes("OTHER")), policy);

    const isValid = await absContract.verifyAttributeSignature.staticCall(
      ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001")),
      policy,
      signature
    );
    assert.equal(isValid, false);
  });

  it("rejects signatures shorter than 65 bytes (issue #10796)", async function () {
    const { absContract } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";

    await assertRejectsWith(
      absContract.verifyAttributeSignature(manifestHash, policy, ethers.toBeHex(1, 32)),
      "Invalid signature dimensions for ABS pairing"
    );
  });
});
