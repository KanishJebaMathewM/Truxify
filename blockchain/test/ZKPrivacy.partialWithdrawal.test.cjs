const { expect } = require("chai");
const { ethers } = require("hardhat");

function proofWithInput(input) {
  return {
    a: [1n, 2n],
    b: [
      [3n, 4n],
      [5n, 6n],
    ],
    c: [7n, 8n],
    input,
  };
}

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

describe("ZKPrivacy partial withdrawal", function () {
  let zkPrivacy, verifier;
  let depositor, recipient;

  beforeEach(async function () {
    [depositor, recipient] = await ethers.getSigners();

    const MockVerifier = await ethers.getContractFactory("MockZKPrivacyVerifier");
    verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();

    const ZKPrivacy = await ethers.getContractFactory("ZKPrivacy");
    zkPrivacy = await ZKPrivacy.deploy(await verifier.getAddress());
    await zkPrivacy.waitForDeployment();
  });

  async function deposit(commitment, amount) {
    await zkPrivacy.connect(depositor).deposit(commitment, { value: amount });
  }

  async function spend(commitment, nullifier, amount) {
    const input = [
      BigInt(nullifier),
      BigInt(commitment),
      BigInt(recipient.address),
      amount,
    ];
    await verifier.setShouldVerify(true);
    await verifier.setExpectedInput(input);
    return zkPrivacy
      .connect(depositor)
      .processPrivateTransaction(nullifier, commitment, recipient.address, amount, proofWithInput(input));
  }

  it("keeps a partially spent commitment spendable (issue #10794)", async function () {
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-partial"));
    await deposit(commitment, ethers.parseEther("2"));

    const firstNullifier = ethers.keccak256(ethers.toUtf8Bytes("nullifier-1"));
    await spend(commitment, firstNullifier, ethers.parseEther("0.5"));

    expect(await zkPrivacy.commitmentAmounts(commitment)).to.equal(ethers.parseEther("1.5"));
    expect(await zkPrivacy.spentCommitments(commitment)).to.equal(false);
    expect(await zkPrivacy.nullifiers(firstNullifier)).to.equal(true);
  });

  it("marks a commitment spent only when fully drained (issue #10794)", async function () {
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-full"));
    await deposit(commitment, ethers.parseEther("1"));

    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("nullifier-full"));
    await spend(commitment, nullifier, ethers.parseEther("1"));

    expect(await zkPrivacy.commitmentAmounts(commitment)).to.equal(0n);
    expect(await zkPrivacy.spentCommitments(commitment)).to.equal(true);
  });

  it("allows sequential partial withdrawals draining the full balance (issue #10794)", async function () {
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-sequential"));
    await deposit(commitment, ethers.parseEther("2"));

    await spend(commitment, ethers.keccak256(ethers.toUtf8Bytes("nullifier-a")), ethers.parseEther("0.5"));
    expect(await zkPrivacy.commitmentAmounts(commitment)).to.equal(ethers.parseEther("1.5"));

    await spend(commitment, ethers.keccak256(ethers.toUtf8Bytes("nullifier-b")), ethers.parseEther("1.0"));
    expect(await zkPrivacy.commitmentAmounts(commitment)).to.equal(ethers.parseEther("0.5"));

    await spend(commitment, ethers.keccak256(ethers.toUtf8Bytes("nullifier-c")), ethers.parseEther("0.5"));
    expect(await zkPrivacy.commitmentAmounts(commitment)).to.equal(0n);
    expect(await zkPrivacy.spentCommitments(commitment)).to.equal(true);
  });

  it("rejects an overdraw beyond the remaining balance", async function () {
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-overdraw"));
    await deposit(commitment, ethers.parseEther("1"));
    await spend(commitment, ethers.keccak256(ethers.toUtf8Bytes("nullifier-x")), ethers.parseEther("0.4"));

    await expectRevert(
      spend(commitment, ethers.keccak256(ethers.toUtf8Bytes("nullifier-y")), ethers.parseEther("0.7")),
      "Insufficient deposit amount"
    );
  });

  it("rejects spending a fully drained commitment", async function () {
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-drained"));
    await deposit(commitment, ethers.parseEther("1"));
    await spend(commitment, ethers.keccak256(ethers.toUtf8Bytes("nullifier-d1")), ethers.parseEther("1"));

    await expectRevert(
      spend(commitment, ethers.keccak256(ethers.toUtf8Bytes("nullifier-d2")), ethers.parseEther("0.1")),
      "Commitment already spent"
    );
  });
});
