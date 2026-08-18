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

  it("Should revert a replayed payout id instead of paying out twice", async function () {
    const [owner, driver, taxAuth] = await ethers.getSigners();
    const TaxSplitter = await ethers.getContractFactory("TaxSplitter");
    const splitter = await TaxSplitter.deploy();

    const payoutId = ethers.keccak256(ethers.toUtf8Bytes("PAYOUT_RETRY"));
    const totalAmount = ethers.parseEther("1.0");

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

    const driverAfterFirst = await ethers.provider.getBalance(driver.address);
    const taxAuthAfterFirst = await ethers.provider.getBalance(taxAuth.address);

    // The payer retries the same logical payout, e.g. after a timed-out RPC.
    await expect(
      splitter.splitPayout(
        payoutId,
        driver.address,
        taxAuth.address,
        totalAmount,
        12,
        1,
        { value: totalAmount }
      )
    ).to.be.revertedWith("Payout already processed");

    // Neither wallet was credited a second time.
    expect(await ethers.provider.getBalance(driver.address)).to.equal(driverAfterFirst);
    expect(await ethers.provider.getBalance(taxAuth.address)).to.equal(taxAuthAfterFirst);
  });

  it("Should expose processedPayouts so a payer can check before retrying", async function () {
    const [owner, driver, taxAuth] = await ethers.getSigners();
    const TaxSplitter = await ethers.getContractFactory("TaxSplitter");
    const splitter = await TaxSplitter.deploy();

    const payoutId = ethers.keccak256(ethers.toUtf8Bytes("PAYOUT_LOOKUP"));
    const totalAmount = ethers.parseEther("1.0");

    expect(await splitter.processedPayouts(payoutId)).to.equal(false);

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

    expect(await splitter.processedPayouts(payoutId)).to.equal(true);
  });

  it("Should still process a distinct payout id after an earlier one settled", async function () {
    const [owner, driver, taxAuth] = await ethers.getSigners();
    const TaxSplitter = await ethers.getContractFactory("TaxSplitter");
    const splitter = await TaxSplitter.deploy();

    const totalAmount = ethers.parseEther("1.0");
    const firstId = ethers.keccak256(ethers.toUtf8Bytes("PAYOUT_SEQ_1"));
    const secondId = ethers.keccak256(ethers.toUtf8Bytes("PAYOUT_SEQ_2"));

    await (await splitter.splitPayout(
      firstId, driver.address, taxAuth.address, totalAmount, 12, 1, { value: totalAmount }
    )).wait();

    const taxAuthBefore = await ethers.provider.getBalance(taxAuth.address);

    // A different payout id is unrelated and must go through normally.
    await (await splitter.splitPayout(
      secondId, driver.address, taxAuth.address, totalAmount, 12, 1, { value: totalAmount }
    )).wait();

    const taxAuthAfter = await ethers.provider.getBalance(taxAuth.address);
    expect(taxAuthAfter - taxAuthBefore).to.equal(ethers.parseEther("0.13"));
    expect(await splitter.processedPayouts(secondId)).to.equal(true);
  });

  it("Should block a tax-authority re-entrancy replay of the in-flight payout id", async function () {
    const [owner, driver] = await ethers.getSigners();
    const TaxSplitter = await ethers.getContractFactory("TaxSplitter");
    const splitter = await TaxSplitter.deploy();

    const ReentrantTaxAuthority = await ethers.getContractFactory("ReentrantTaxAuthority");
    const attacker = await ReentrantTaxAuthority.deploy(await splitter.getAddress());

    const payoutId = ethers.keccak256(ethers.toUtf8Bytes("PAYOUT_REENTRANT"));
    const totalAmount = ethers.parseEther("1.0");

    // Fund the attacker so its re-entrant call can carry its own msg.value.
    await (await attacker.arm(payoutId, driver.address, { value: ethers.parseEther("1.0") })).wait();

    const driverBefore = await ethers.provider.getBalance(driver.address);
    await (await splitter.splitPayout(
      payoutId,
      driver.address,
      await attacker.getAddress(),
      totalAmount,
      12,
      1,
      { value: totalAmount }
    )).wait();
    const driverAfter = await ethers.provider.getBalance(driver.address);

    // The re-entrant call hit the guard, so the driver was paid exactly once.
    expect(await attacker.reentrySucceeded()).to.equal(false);
    expect(driverAfter - driverBefore).to.equal(ethers.parseEther("0.87"));
  });
});
