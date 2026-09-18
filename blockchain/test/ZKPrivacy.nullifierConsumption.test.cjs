const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Build a deterministic mock Groth16 proof payload with the supplied public inputs.
 */
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

/**
 * Assert that a Hardhat transaction reverts with the expected reason text.
 */
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

describe("ZKPrivacy nullifier consumption", function () {
  let zkPrivacy;
  let verifier;
  let sender;
  let recipient;

  beforeEach(async function () {
    [sender, recipient] = await ethers.getSigners();

    const MockVerifier = await ethers.getContractFactory("MockZKPrivacyVerifier");
    verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();

    const ZKPrivacy = await ethers.getContractFactory("ZKPrivacy");
    zkPrivacy = await ZKPrivacy.deploy(await verifier.getAddress());
    await zkPrivacy.waitForDeployment();
  });

  it("does not consume the generated nullifier when creating a private transaction", async function () {
    const amount = ethers.parseEther("1");
    const encryptedData = ethers.toUtf8Bytes("encrypted-note");
    const tx = await zkPrivacy
      .connect(sender)
      .createPrivateTransaction(recipient.address, amount, encryptedData);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);

    const commitment = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256"],
      [block.timestamp, sender.address, amount]
    );
    const nullifier = ethers.solidityPackedKeccak256(
      ["bytes32", "uint256"],
      [commitment, block.timestamp]
    );

    expect(await zkPrivacy.isCommitmentUsed(commitment)).to.equal(true);
    expect(await zkPrivacy.isNullifierUsed(nullifier)).to.equal(false);

    const stored = await zkPrivacy.getTransaction(
      ethers.solidityPackedKeccak256(
        ["uint256", "uint256"],
        [block.timestamp, await zkPrivacy.getTransactionCount()]
      )
    );
    expect(stored.nullifier).to.equal(nullifier);
    expect(stored.spent).to.equal(false);
  });

  it("does not consume a nullifier when spend proof verification fails", async function () {
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-proof-failure"));
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("nullifier-proof-failure"));
    const amount = ethers.parseEther("1");
    await zkPrivacy.connect(sender).deposit(commitment, { value: amount });

    const input = [
      BigInt(nullifier),
      BigInt(commitment),
      BigInt(recipient.address),
      amount,
    ];
    await verifier.setExpectedInput(input);
    await verifier.setShouldVerify(false);

    await expectRevert(
      zkPrivacy
        .connect(sender)
        .processPrivateTransaction(
          nullifier,
          commitment,
          recipient.address,
          amount,
          proofWithInput(input)
        ),
      "Invalid proof"
    );

    expect(await zkPrivacy.isNullifierUsed(nullifier)).to.equal(false);
    expect(await zkPrivacy.commitmentAmounts(commitment)).to.equal(amount);
  });

  it("consumes the nullifier only after a valid spend proof succeeds", async function () {
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-proof-success"));
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("nullifier-proof-success"));
    const amount = ethers.parseEther("1");
    await zkPrivacy.connect(sender).deposit(commitment, { value: amount });

    const input = [
      BigInt(nullifier),
      BigInt(commitment),
      BigInt(recipient.address),
      amount,
    ];
    await verifier.setExpectedInput(input);
    await verifier.setShouldVerify(true);

    await zkPrivacy
      .connect(sender)
      .processPrivateTransaction(
        nullifier,
        commitment,
        recipient.address,
        amount,
        proofWithInput(input)
      );

    expect(await zkPrivacy.isNullifierUsed(nullifier)).to.equal(true);
    expect(await zkPrivacy.commitmentAmounts(commitment)).to.equal(0n);
    expect(await zkPrivacy.spentCommitments(commitment)).to.equal(true);

    await expectRevert(
      zkPrivacy
        .connect(sender)
        .processPrivateTransaction(
          nullifier,
          commitment,
          recipient.address,
          amount,
          proofWithInput(input)
        ),
      "Nullifier already used"
    );
  });
});
