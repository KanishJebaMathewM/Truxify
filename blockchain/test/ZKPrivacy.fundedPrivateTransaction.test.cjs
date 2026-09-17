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
    if (reason.toLowerCase().includes(expectedMessage.toLowerCase())) {
      return;
    }

    const fullMessage = JSON.stringify(error).toLowerCase();
    expect(fullMessage).to.include(expectedMessage.toLowerCase());
  }
}

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

describe("ZKPrivacy funded private transaction creation", function () {
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

  async function createFundedTransaction(amount) {
    const tx = await zkPrivacy.connect(sender).createPrivateTransaction(
      recipient.address,
      amount,
      "0x1234",
      { value: amount }
    );
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

    return { commitment, nullifier };
  }

  it("funds and registers the generated commitment", async function () {
    const amount = ethers.parseEther("1");
    const { commitment } = await createFundedTransaction(amount);

    expect(await zkPrivacy.commitments(commitment)).to.equal(true);
    expect(await zkPrivacy.commitmentAmounts(commitment)).to.equal(amount);
    expect(await ethers.provider.getBalance(await zkPrivacy.getAddress())).to.equal(amount);
  });

  it("does not create a commitment when the supplied value is too low", async function () {
    const amount = ethers.parseEther("1");

    await expectRevert(
      zkPrivacy.connect(sender).createPrivateTransaction(
        recipient.address,
        amount,
        "0x1234",
        { value: ethers.parseEther("0.5") }
      ),
      "Funding amount must equal transaction amount"
    );

    expect(await zkPrivacy.getTransactionCount()).to.equal(0n);
  });

  it("does not accept excess value for a private transaction", async function () {
    const amount = ethers.parseEther("1");

    await expectRevert(
      zkPrivacy.connect(sender).createPrivateTransaction(
        recipient.address,
        amount,
        "0x1234",
        { value: ethers.parseEther("1.5") }
      ),
      "Funding amount must equal transaction amount"
    );

    expect(await zkPrivacy.getTransactionCount()).to.equal(0n);
    expect(await ethers.provider.getBalance(await zkPrivacy.getAddress())).to.equal(0n);
  });

  it("can spend the commitment created by createPrivateTransaction", async function () {
    const amount = ethers.parseEther("1");
    const { commitment, nullifier } = await createFundedTransaction(amount);
    const input = [
      BigInt(nullifier),
      BigInt(commitment),
      BigInt(recipient.address),
      amount,
    ];

    await verifier.setShouldVerify(true);
    await verifier.setExpectedInput(input);

    await zkPrivacy.connect(sender).processPrivateTransaction(
      nullifier,
      commitment,
      recipient.address,
      amount,
      proofWithInput(input)
    );

    expect(await zkPrivacy.commitmentAmounts(commitment)).to.equal(0n);
    expect(await zkPrivacy.spentCommitments(commitment)).to.equal(true);
    expect(await zkPrivacy.nullifiers(nullifier)).to.equal(true);
  });
});
