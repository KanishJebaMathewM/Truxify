const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TaxSplitter Contract", function () {
  it("Should calculate and route tax split percentages correctly on payout", async function () {
    const [owner, driver, taxAuth] = await ethers.getSigners();
    const TaxSplitter = await ethers.getContractFactory("TaxSplitter");
    const splitter = await TaxSplitter.deploy();

    const payoutId = ethers.keccak256(ethers.toUtf8Bytes("PAYOUT_ORDER_909"));
    const totalAmount = ethers.parseEther("1.0");

    // 12% GST + 1% TDS = 13% tax = 0.13 ETH, net = 0.87 ETH
    const tx = await splitter.splitPayout(
      payoutId,
      driver.address,
      taxAuth.address,
      totalAmount,
      12,
      1,
      { value: totalAmount }
    );
    await tx.wait();

    // Verify balances (approximate due to gas, but receiver has no gas costs)
    const driverBalance = await ethers.provider.getBalance(driver.address);
    expect(driverBalance).to.be.greaterThan(ethers.parseEther("10000.86")); // Default signers start with 10000 ETH
  });

  it("Should revert when combined tax rates exceed 100%", async function () {
    const [owner, driver, taxAuth] = await ethers.getSigners();
    const TaxSplitter = await ethers.getContractFactory("TaxSplitter");
    const splitter = await TaxSplitter.deploy();

    const payoutId = ethers.keccak256(ethers.toUtf8Bytes("PAYOUT_OVERFLOW"));
    const totalAmount = ethers.parseEther("1.0");

    await expect(
      splitter.splitPayout(
        payoutId,
        driver.address,
        taxAuth.address,
        totalAmount,
        60,
        50, // 60 + 50 = 110% > 100%
        { value: totalAmount }
      )
    ).to.be.revertedWith("Tax rates exceed 100%");
  });

  it("Should route 100% to tax authority and leave driver with zero payout", async function () {
    const [owner, driver, taxAuth] = await ethers.getSigners();
    const TaxSplitter = await ethers.getContractFactory("TaxSplitter");
    const splitter = await TaxSplitter.deploy();

    const payoutId = ethers.keccak256(ethers.toUtf8Bytes("PAYOUT_ZERO_DRIVER"));
    const totalAmount = ethers.parseEther("1.0");

    const taxAuthBefore = await ethers.provider.getBalance(taxAuth.address);
    const tx = await splitter.splitPayout(
      payoutId,
      driver.address,
      taxAuth.address,
      totalAmount,
      100,
      0, // 100% GST -> net driver payout is 0
      { value: totalAmount }
    );
    await tx.wait();

    const taxAuthAfter = await ethers.provider.getBalance(taxAuth.address);
    // Tax authority receives the entire amount, contract holds nothing.
    expect(taxAuthAfter - taxAuthBefore).to.equal(totalAmount);
    expect(await ethers.provider.getBalance(splitter.getAddress())).to.equal(0n);
  });

  it("Should refund excess msg.value sent beyond the total amount", async function () {
    const [owner, driver, taxAuth] = await ethers.getSigners();
    const TaxSplitter = await ethers.getContractFactory("TaxSplitter");
    const splitter = await TaxSplitter.deploy();

    const payoutId = ethers.keccak256(ethers.toUtf8Bytes("PAYOUT_REFUND"));
    const totalAmount = ethers.parseEther("1.0");
    const excess = ethers.parseEther("0.5");
    const sent = totalAmount + excess;

    const senderBefore = await ethers.provider.getBalance(owner.address);
    const taxAuthBefore = await ethers.provider.getBalance(taxAuth.address);
    const tx = await splitter.splitPayout(
      payoutId,
      driver.address,
      taxAuth.address,
      totalAmount,
      12,
      1,
      { value: sent }
    );
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed * receipt.gasPrice;

    const senderAfter = await ethers.provider.getBalance(owner.address);
    const taxAuthAfter = await ethers.provider.getBalance(taxAuth.address);

    // Only the total amount is consumed (tax + driver); excess is refunded.
    const consumed = senderBefore - senderAfter - gasUsed;
    expect(consumed).to.equal(totalAmount);
    expect(taxAuthAfter - taxAuthBefore).to.equal(ethers.parseEther("0.13"));
    expect(await ethers.provider.getBalance(splitter.getAddress())).to.equal(0n);
  });
});
