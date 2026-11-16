// blockchain/test/DriverReputation.test.js
// Tests for on-chain driver reputation scoring (Reputation contract)

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Reputation Contract", function () {
  let reputation;
  let owner;
  let driver;
  let relayer;

  beforeEach(async function () {
    [owner, driver, relayer] = await ethers.getSigners();

    // Reputation awards are relayer-gated: deploy with an initial relayer.
    const ReputationFactory = await ethers.getContractFactory("Reputation");
    reputation = await ReputationFactory.deploy(relayer.address);
    await reputation.waitForDeployment();
  });

  it("New driver starts with zero reputation score", async function () {
    const score = await reputation.getReputation(driver.address);
    expect(score).to.equal(0);
  });

  it("Score increases after a relayer award", async function () {
    await reputation.connect(relayer).increaseReputation(driver.address, 5);

    const score = await reputation.getReputation(driver.address);
    expect(score).to.be.greaterThan(0);
  });

  it("Score does not exceed MAX_REPUTATION", async function () {
    const max = await reputation.MAX_REPUTATION();

    await reputation.connect(relayer).increaseReputation(driver.address, max + 5000n);

    const score = await reputation.getReputation(driver.address);
    expect(score).to.equal(max);

    // Once at the cap, further awards revert instead of overflowing.
    await expect(
      reputation.connect(relayer).increaseReputation(driver.address, 1)
    ).to.be.revertedWith("already at max reputation");
  });

  it("Zero-points award is rejected", async function () {
    await expect(
      reputation.connect(relayer).increaseReputation(driver.address, 0)
    ).to.be.revertedWith("Points must be > 0");
  });

  it("Non-relayer cannot award reputation", async function () {
    await expect(
      reputation.connect(driver).increaseReputation(driver.address, 5)
    ).to.be.revertedWith("Not authorized relayer");
  });
});
