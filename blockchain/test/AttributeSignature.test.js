import assert from "node:assert/strict";
import hre from "hardhat";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

describe("AttributeSignature ABS Verification", function () {
  async function deploy() {
    const [owner, authority, subject] = await ethers.getSigners();
    const AttributeSignature = await ethers.getContractFactory("AttributeSignature");
    const absContract = await AttributeSignature.deploy();
    await absContract.waitForDeployment();
    return { absContract, owner, authority, subject };
  }

  // The permit binds manifest hash, policy predicate, subject, nonce and
  // expiry: EIP-191 over keccak256(abi.encode(manifestHash, policy, subject,
  // nonce, expiry)) (issue #10796).
  async function signFor(signer, manifestHash, policy, subject, nonce, expiry) {
    const inner = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "string", "address", "uint256", "uint256"],
        [manifestHash, policy, subject, nonce, expiry]
      )
    );
    return signer.signMessage(ethers.getBytes(inner));
  }

  const futureExpiry = async () => (await ethers.provider.getBlock("latest")).timestamp + 3600;

  it("verifies a valid signature by a trusted issuer (issue #10796)", async function () {
    const { absContract, owner, authority, subject } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";
    const nonce = 1n;
    const expiry = await futureExpiry();

    await absContract.connect(owner).setTrustedIssuer(authority.address, true);
    const signature = await signFor(authority, manifestHash, policy, subject.address, nonce, expiry);
    const isValid = await absContract.verifyAttributeSignature.staticCall(
      manifestHash, policy, subject.address, nonce, expiry, signature
    );

    assert.equal(isValid, true);
  });

  it("rejects a signature from an unregistered issuer (issue #10796)", async function () {
    const { absContract, authority, subject } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";
    const nonce = 1n;
    const expiry = await futureExpiry();

    const signature = await signFor(authority, manifestHash, policy, subject.address, nonce, expiry);
    const isValid = await absContract.verifyAttributeSignature.staticCall(
      manifestHash, policy, subject.address, nonce, expiry, signature
    );

    assert.equal(isValid, false);
  });

  it("rejects an arbitrary non-zero signature blob (issue #10796)", async function () {
    const { absContract, subject } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";
    const nonce = 1n;
    const expiry = await futureExpiry();

    const arbitrarySignature = ethers.concat([
      ethers.toBeHex(1, 32),
      ethers.toBeHex(2, 32),
      ethers.toBeHex(27, 1),
    ]);

    const isValid = await absContract.verifyAttributeSignature.staticCall(
      manifestHash, policy, subject.address, nonce, expiry, arbitrarySignature
    );
    assert.equal(isValid, false);
  });

  it("rejects a signature bound to a different policy predicate (issue #10796)", async function () {
    const { absContract, owner, authority, subject } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";
    const nonce = 1n;
    const expiry = await futureExpiry();

    await absContract.connect(owner).setTrustedIssuer(authority.address, true);
    // Signature is valid for the manifest, but not for this policy.
    const signature = await signFor(authority, manifestHash, "Driver.experience >= 3", subject.address, nonce, expiry);

    const isValid = await absContract.verifyAttributeSignature.staticCall(
      manifestHash, policy, subject.address, nonce, expiry, signature
    );
    assert.equal(isValid, false);
  });

  it("rejects a signature bound to a different manifest hash (issue #10796)", async function () {
    const { absContract, owner, authority, subject } = await deploy();
    const policy = "Driver.hazmat == true";
    const nonce = 1n;
    const expiry = await futureExpiry();

    await absContract.connect(owner).setTrustedIssuer(authority.address, true);
    const signature = await signFor(
      authority, ethers.keccak256(ethers.toUtf8Bytes("OTHER")), policy, subject.address, nonce, expiry
    );

    const isValid = await absContract.verifyAttributeSignature.staticCall(
      ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001")),
      policy,
      subject.address,
      nonce,
      expiry,
      signature
    );
    assert.equal(isValid, false);
  });

  it("rejects a signature bound to a different subject (issue #10796)", async function () {
    const { absContract, owner, authority, subject } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";
    const nonce = 1n;
    const expiry = await futureExpiry();

    await absContract.connect(owner).setTrustedIssuer(authority.address, true);
    const signature = await signFor(authority, manifestHash, policy, owner.address, nonce, expiry);

    const isValid = await absContract.verifyAttributeSignature.staticCall(
      manifestHash, policy, subject.address, nonce, expiry, signature
    );
    assert.equal(isValid, false);
  });

  it("rejects an expired permit (issue #10796)", async function () {
    const { absContract, owner, authority, subject } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";
    const nonce = 1n;
    const expiry = (await ethers.provider.getBlock("latest")).timestamp - 1;

    await absContract.connect(owner).setTrustedIssuer(authority.address, true);
    const signature = await signFor(authority, manifestHash, policy, subject.address, nonce, expiry);

    await assertRejectsWith(
      absContract.verifyAttributeSignature(manifestHash, policy, subject.address, nonce, expiry, signature),
      "Attribute permit expired"
    );
  });

  it("rejects signatures shorter than 65 bytes (issue #10796)", async function () {
    const { absContract, subject } = await deploy();
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("HAZMAT_PERMIT_001"));
    const policy = "Driver.hazmat == true";
    const expiry = await futureExpiry();

    await assertRejectsWith(
      absContract.verifyAttributeSignature(manifestHash, policy, subject.address, 1n, expiry, ethers.toBeHex(1, 32)),
      "Invalid signature dimensions for ABS pairing"
    );
  });
});
