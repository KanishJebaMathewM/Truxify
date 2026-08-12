import assert from "node:assert/strict";
import hre from "hardhat";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

function encodeProof(a, b, c, input) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[2]"],
    [a, b, c, input]
  );
}

describe("ZK proof verification", function () {
  async function deployZkEVM() {
    const [owner, user] = await ethers.getSigners();
    const Verifier = await ethers.getContractFactory("Verifier");
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();
    const zkEVM = await (await ethers.getContractFactory("zkEVM")).deploy(await verifier.getAddress());
    await zkEVM.waitForDeployment();
    return { verifier, zkEVM, owner, user };
  }

  it("rejects an all-zero proof in Verifier.verifyProof", async function () {
    const { verifier } = await deployZkEVM();
    assert.equal(
      await verifier.verifyProof([0, 0], [[0, 0], [0, 0]], [0, 0], [1, 1]),
      false
    );
  });

  it("rejects an empty public input in Verifier.verifyProof", async function () {
    const { verifier } = await deployZkEVM();
    assert.equal(
      await verifier.verifyProof([1, 2], [[1, 2], [1, 2]], [1, 2], [0, 0]),
      false
    );
  });

  it("rejects a fabricated on-curve proof in Verifier.verifyProof", async function () {
    const { verifier } = await deployZkEVM();
    // (1,2) is a valid point on the BN254 curve, so the old placeholder
    // accepted it; verifyProof must now fail closed for every proof.
    assert.equal(
      await verifier.verifyProof([1, 2], [[1, 2], [1, 2]], [1, 2], [1, 1]),
      false
    );
  });

  it("rejects a withdrawal with an empty proof", async function () {
    const { zkEVM, user } = await deployZkEVM();
    await zkEVM.connect(user).depositToL2({ value: ethers.parseEther("1") });
    await assertRejectsWith(
      zkEVM.connect(user).withdrawFromL2(ethers.parseEther("0.5"), "0x"),
      "Empty proof"
    );
  });

  it("rejects a withdrawal with a malformed proof", async function () {
    const { zkEVM, user } = await deployZkEVM();
    await zkEVM.connect(user).depositToL2({ value: ethers.parseEther("1") });
    await assert.rejects(
      zkEVM.connect(user).withdrawFromL2(ethers.parseEther("0.5"), "0xdeadbeef")
    );
  });

  it("rejects a withdrawal with an all-zero proof", async function () {
    const { zkEVM, user } = await deployZkEVM();
    await zkEVM.connect(user).depositToL2({ value: ethers.parseEther("1") });
    const zeroProof = encodeProof([0, 0], [[0, 0], [0, 0]], [0, 0], [1, 1]);
    await assertRejectsWith(
      zkEVM.connect(user).withdrawFromL2(ethers.parseEther("0.5"), zeroProof),
      "Invalid"
    );
  });

  it("rejects an empty batch proof", async function () {
    const { zkEVM, owner } = await deployZkEVM();
    await assertRejectsWith(
      zkEVM.connect(owner).executeBatch(["0x1234"], "0x"),
      "Empty proof"
    );
  });

  it("rejects arbitrary proof bytes in zkSTARKVerifier (issue #10797)", async function () {
    const mock = await (await ethers.getContractFactory("MockSTARKVerifier")).deploy();
    await mock.waitForDeployment();
    const zkSTARKVerifier = await (await ethers.getContractFactory("zkSTARKVerifier")).deploy(await mock.getAddress());
    await zkSTARKVerifier.waitForDeployment();

    const publicInputs = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256[]"],
      [123n, [1n, 2n]]
    );

    // Arbitrary proof bytes must NOT verify.
    assert.equal(await zkSTARKVerifier.verifyProof("0x1234", publicInputs), false);

    // Empty proofs are rejected outright.
    await assertRejectsWith(
      zkSTARKVerifier.verifyProof("0x", publicInputs),
      "Proof is empty"
    );
  });

  it("rejects zero proofs in KYCVerifier.verifyKYC", async function () {
    const kycVerifier = await (await ethers.getContractFactory("KYCVerifier")).deploy();
    await kycVerifier.waitForDeployment();
    const [admin, user] = await ethers.getSigners();

    await assertRejectsWith(
      kycVerifier.connect(admin).verifyKYC([0, 0], [[0, 0], [0, 0]], [0, 0], [0, 0], user.address),
      "Zero proof rejected"
    );
  });

  it("does not mark a user verified with a fabricated proof in KYCVerifier", async function () {
    const kycVerifier = await (await ethers.getContractFactory("KYCVerifier")).deploy();
    await kycVerifier.waitForDeployment();
    const [admin, user] = await ethers.getSigners();

    // Bind the proof to the user (as KYCVerifier requires), but use a
    // fabricated on-curve proof that must still fail verification.
    const boundInput = [BigInt(user.address), 1n];
    const verified = await kycVerifier
      .connect(admin)
      .verifyKYC.staticCall([1, 2], [[1, 2], [1, 2]], [1, 2], boundInput, user.address);
    assert.equal(verified, false);
    assert.equal(await kycVerifier.isVerified(user.address), false);
  });
});
