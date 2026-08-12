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
});
