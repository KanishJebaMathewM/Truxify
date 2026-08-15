const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

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

describe("ZKCP Route Data Swaps", function () {
  it("Should lock payment and release atomically upon key validation", async function () {
    const [buyer, seller] = await ethers.getSigners();
    const ZKCP = await ethers.getContractFactory("ZKCP");
    const zkcp = await ZKCP.deploy();

    const agreementId = ethers.keccak256(ethers.toUtf8Bytes("AGREEMENT_101"));
    const key = ethers.keccak256(ethers.toUtf8Bytes("DECRYPTION_SECRET_KEY_456"));
    
    // Hash commitment corresponding to SHA256 of the secret key
    const rawBytes = ethers.toBeHex(key);
    const dataHash = ethers.sha256(rawBytes);

    // Lock 1 ETH payment
    await zkcp.connect(buyer).lockPayment(
      agreementId,
      seller.address,
      dataHash,
      3600, // 1 hour timelock
      { value: ethers.parseEther("1.0") }
    );

    // Claim payment using secret decryption key
    await zkcp.connect(seller).claimPayment(agreementId, key);

    const agreement = await zkcp.agreements(agreementId);
    expect(agreement.completed).to.equal(true);
    expect(agreement.keyRevealed).to.equal(true);
  });

  it("allows the buyer to refund after the timelock when the key was never revealed", async function () {
    const [buyer, seller] = await ethers.getSigners();
    const ZKCP = await ethers.getContractFactory("ZKCP");
    const zkcp = await ZKCP.deploy();

    const agreementId = ethers.keccak256(ethers.toUtf8Bytes("AGREEMENT_REFUND"));
    const key = ethers.keccak256(ethers.toUtf8Bytes("SECRET_REFUND"));
    const dataHash = ethers.sha256(ethers.toBeHex(key));

    await zkcp.connect(buyer).lockPayment(
      agreementId,
      seller.address,
      dataHash,
      3600,
      { value: ethers.parseEther("1.0") }
    );

    await time.increase(3601);

    const balanceBefore = await ethers.provider.getBalance(buyer.address);
    await zkcp.connect(buyer).refundBuyer(agreementId);
    const balanceAfter = await ethers.provider.getBalance(buyer.address);

    const agreement = await zkcp.agreements(agreementId);
    expect(agreement.completed).to.equal(true);
    expect(agreement.keyRevealed).to.equal(false);
    expect(balanceAfter).to.be.greaterThan(balanceBefore);
  });

  it("reverts when a non-buyer tries to trigger the refund", async function () {
    const [buyer, seller, attacker] = await ethers.getSigners();
    const ZKCP = await ethers.getContractFactory("ZKCP");
    const zkcp = await ZKCP.deploy();

    const agreementId = ethers.keccak256(ethers.toUtf8Bytes("AGREEMENT_ATTACK"));
    const key = ethers.keccak256(ethers.toUtf8Bytes("SECRET_ATTACK"));
    const dataHash = ethers.sha256(ethers.toBeHex(key));

    await zkcp.connect(buyer).lockPayment(
      agreementId,
      seller.address,
      dataHash,
      3600,
      { value: ethers.parseEther("1.0") }
    );

    await time.increase(3601);

    await expectRevert(
      zkcp.connect(attacker).refundBuyer(agreementId),
      "Only buyer can refund"
    );
  });

  it("reverts when refunding after the key was already revealed", async function () {
    const [buyer, seller] = await ethers.getSigners();
    const ZKCP = await ethers.getContractFactory("ZKCP");
    const zkcp = await ZKCP.deploy();

    const agreementId = ethers.keccak256(ethers.toUtf8Bytes("AGREEMENT_DELIVERED"));
    const key = ethers.keccak256(ethers.toUtf8Bytes("SECRET_DELIVERED"));
    const dataHash = ethers.sha256(ethers.toBeHex(key));

    await zkcp.connect(buyer).lockPayment(
      agreementId,
      seller.address,
      dataHash,
      3600,
      { value: ethers.parseEther("1.0") }
    );

    await zkcp.connect(seller).claimPayment(agreementId, key);

    await time.increase(3601);

    await expectRevert(
      zkcp.connect(buyer).refundBuyer(agreementId),
      "Agreement already completed"
    );
  });
});
