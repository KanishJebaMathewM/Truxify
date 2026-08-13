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
  let zkPrivacy, verifier;
  let owner, recipient;

  const PROGRAM_INPUTS = (recipient, amount) => [
    BigInt(recipient),
    amount,
  ];
  const PROOF_A = [1, 2];
  const PROOF_B = [[1, 2], [1, 2]];
  const PROOF_C = [1, 2];

  beforeEach(async function () {
    [owner, recipient] = await ethers.getSigners();

    const MockVerifier = await ethers.getContractFactory("MockZKPrivacyVerifier");
    verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();

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

  it("reverts when no verifier is wired in (issue #10795)", async function () {
    const ZKPrivacy = await ethers.getContractFactory("ZKPrivacy");
    const noVerifier = await ZKPrivacy.deploy(ethers.ZeroAddress);
    await noVerifier.waitForDeployment();

    const amount = ethers.parseEther("1");
    await expectRevert(
      noVerifier
        .connect(owner)
        .processSTARKTransaction(
          PROOF_A,
          PROOF_B,
          PROOF_C,
          PROGRAM_INPUTS(recipient.address, amount),
          recipient.address,
          amount
        ),
      "Verifier not set"
    );
  });

  it("transfers the value to the recipient after verification (issue #10795)", async function () {
    await verifier.setShouldVerify(true);
    const amount = ethers.parseEther("1");
    await verifier.setExpectedInput(PROGRAM_INPUTS(recipient.address, amount));

    const before = await ethers.provider.getBalance(recipient.address);

    await expect(
      zkPrivacy
        .connect(owner)
        .processSTARKTransaction(
          PROOF_A,
          PROOF_B,
          PROOF_C,
          PROGRAM_INPUTS(recipient.address, amount),
          recipient.address,
          amount
        )
    ).to.emit(zkPrivacy, "TransactionProcessed");

    const after = await ethers.provider.getBalance(recipient.address);
    expect(after - before).to.equal(amount);
  });

  it("rejects a proof whose public inputs do not bind the recipient", async function () {
    await verifier.setShouldVerify(true);
    const [other] = await ethers.getSigners();
    const amount = ethers.parseEther("1");
    await verifier.setExpectedInput(PROGRAM_INPUTS(recipient.address, amount));

    await expectRevert(
      zkPrivacy
        .connect(owner)
        .processSTARKTransaction(
          PROOF_A,
          PROOF_B,
          PROOF_C,
          PROGRAM_INPUTS(other.address, amount),
          recipient.address,
          amount
        ),
      "Recipient mismatch in proof input"
    );
  });

  it("rejects a proof whose public inputs do not bind the amount", async function () {
    await verifier.setShouldVerify(true);
    const amount = ethers.parseEther("1");
    await verifier.setExpectedInput(PROGRAM_INPUTS(recipient.address, amount));

    await expectRevert(
      zkPrivacy
        .connect(owner)
        .processSTARKTransaction(
          PROOF_A,
          PROOF_B,
          PROOF_C,
          PROGRAM_INPUTS(recipient.address, ethers.parseEther("2")),
          recipient.address,
          amount
        ),
      "Amount mismatch in proof input"
    );
  });

  it("rejects a proof the verifier does not accept", async function () {
    await verifier.setShouldVerify(false);
    const amount = ethers.parseEther("1");
    await verifier.setExpectedInput(PROGRAM_INPUTS(recipient.address, amount));

    await expectRevert(
      zkPrivacy
        .connect(owner)
        .processSTARKTransaction(
          PROOF_A,
          PROOF_B,
          PROOF_C,
          PROGRAM_INPUTS(recipient.address, amount),
          recipient.address,
          amount
        ),
      "Invalid STARK proof"
    );
  });

  it("fails closed in verifySTARK when no verifier is wired in", async function () {
    const ZKPrivacy = await ethers.getContractFactory("ZKPrivacy");
    const noVerifier = await ZKPrivacy.deploy(ethers.ZeroAddress);
    await noVerifier.waitForDeployment();

    await expectRevert(
      noVerifier.verifySTARK(PROOF_A, PROOF_B, PROOF_C, [
        BigInt(recipient.address),
        1,
      ]),
      "Verifier not set"
    );
  });
});
