const { expect } = require("chai");
const { ethers } = require("hardhat");

async function expectRevert(promise, expectedMessage) {
  try {
    await promise;
    expect.fail("Expected transaction to revert");
  } catch (error) {
    const reason =
      error.reason ??
      error.info?.error?.message ??
      error.shortMessage ??
      error.message ??
      "";
    if (!reason.toLowerCase().includes(expectedMessage.toLowerCase())) {
      const fullMsg = JSON.stringify(error).toLowerCase();
      if (!fullMsg.includes(expectedMessage.toLowerCase())) {
        expect.fail(
          `Expected revert reason to include "${expectedMessage}", got: "${reason}"`
        );
      }
    }
  }
}

describe("ZKPrivacy STARK withdrawal", function () {
  let zkPrivacy, starkVerifier;
  let owner, recipient;

  const PROGRAM_INPUTS = (recipient, amount) => [
    BigInt(recipient),
    amount,
  ];

  beforeEach(async function () {
    [owner, recipient] = await ethers.getSigners();

    const MockVerifier = await ethers.getContractFactory("MockZKPrivacyVerifier");
    const verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();

    const MockStarkVerifier = await ethers.getContractFactory("MockZKPrivacyStarkVerifier");
    starkVerifier = await MockStarkVerifier.deploy();
    await starkVerifier.waitForDeployment();

    const ZKPrivacy = await ethers.getContractFactory("ZKPrivacy");
    zkPrivacy = await ZKPrivacy.deploy(await verifier.getAddress());
    await zkPrivacy.waitForDeployment();

    // Fund the contract so withdrawals can be paid out.
    await zkPrivacy
      .connect(owner)
      .deposit(ethers.keccak256(ethers.toUtf8Bytes("escrow-funds")), {
        value: ethers.parseEther("3"),
      });
  });

  it("reverts when no STARK verifier is wired in (issue #10795)", async function () {
    const proof = ethers.toUtf8Bytes("proof-bytes");
    await expectRevert(
      zkPrivacy
        .connect(owner)
        .processSTARKTransaction(
          PROGRAM_INPUTS(recipient.address, ethers.parseEther("1")),
          proof,
          recipient.address,
          ethers.parseEther("1")
        ),
      "STARK verifier not set"
    );
  });

  it("transfers the value to the recipient after verification (issue #10795)", async function () {
    await starkVerifier.setShouldVerify(true);
    await zkPrivacy.connect(owner).setStarkVerifier(await starkVerifier.getAddress());

    const before = await ethers.provider.getBalance(recipient.address);
    const amount = ethers.parseEther("1");

    await expect(
      zkPrivacy
        .connect(owner)
        .processSTARKTransaction(PROGRAM_INPUTS(recipient.address, amount), ethers.toUtf8Bytes("proof-1"), recipient.address, amount)
    ).to.emit(zkPrivacy, "TransactionProcessed");

    const after = await ethers.provider.getBalance(recipient.address);
    expect(after - before).to.equal(amount);
  });

  it("rejects a proof whose public inputs do not bind the recipient", async function () {
    await starkVerifier.setShouldVerify(true);
    await zkPrivacy.connect(owner).setStarkVerifier(await starkVerifier.getAddress());

    const [other] = await ethers.getSigners();
    const amount = ethers.parseEther("1");

    await expectRevert(
      zkPrivacy
        .connect(owner)
        .processSTARKTransaction(
          PROGRAM_INPUTS(other.address, amount),
          ethers.toUtf8Bytes("proof-2"),
          recipient.address,
          amount
        ),
      "Recipient mismatch in proof input"
    );
  });

  it("rejects a replay of an already-spent proof", async function () {
    await starkVerifier.setShouldVerify(true);
    await zkPrivacy.connect(owner).setStarkVerifier(await starkVerifier.getAddress());

    const amount = ethers.parseEther("1");
    const proof = ethers.toUtf8Bytes("proof-replay");

    await zkPrivacy
      .connect(owner)
      .processSTARKTransaction(PROGRAM_INPUTS(recipient.address, amount), proof, recipient.address, amount);

    await expectRevert(
      zkPrivacy
        .connect(owner)
        .processSTARKTransaction(PROGRAM_INPUTS(recipient.address, amount), proof, recipient.address, amount),
      "Proof already spent"
    );
  });

  it("rejects a proof the verifier does not accept", async function () {
    await starkVerifier.setShouldVerify(false);
    await zkPrivacy.connect(owner).setStarkVerifier(await starkVerifier.getAddress());

    const amount = ethers.parseEther("1");
    await expectRevert(
      zkPrivacy
        .connect(owner)
        .processSTARKTransaction(
          PROGRAM_INPUTS(recipient.address, amount),
          ethers.toUtf8Bytes("proof-bad"),
          recipient.address,
          amount
        ),
      "Invalid STARK proof"
    );
  });

  it("fails closed in verifySTARK when no verifier is wired in", async function () {
    expect(await zkPrivacy.verifySTARK(ethers.toUtf8Bytes("proof"), ethers.toUtf8Bytes("inputs"))).to.equal(false);
  });
});
