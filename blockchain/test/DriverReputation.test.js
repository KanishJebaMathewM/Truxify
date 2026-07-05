// blockchain/test/DriverReputation.test.js
// Tests for on-chain driver reputation scoring

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DriverReputation Contract", function () {
  let reputation;
  let owner;
  let driver;
  let customer;

  beforeEach(async function () {
    [owner, driver, customer] = await ethers.getSigners();

    // ⚠️ Replace "DriverReputation" with your actual contract name
    const ReputationFactory = await ethers.getContractFactory("DriverReputation");
    reputation = await ReputationFactory.deploy();
    await reputation.waitForDeployment();
  });

  it("New driver starts with zero reputation score", async function () {
    // ⚠️ Replace "getScore" with your actual function name
    const score = await reputation.getScore(driver.address);
    expect(score).to.equal(0);
  });

  it("Score increases after successful delivery", async function () {
    // ⚠️ Replace "addPositiveRating" with your actual function name
    await reputation.connect(customer).addPositiveRating(driver.address, 5);

    const score = await reputation.getScore(driver.address);
    expect(score).to.be.greaterThan(0);
  });

  it("Score does not exceed maximum (100)", async function () {
    // Add many ratings
    for (let i = 0; i < 10; i++) {
      await reputation.connect(customer).addPositiveRating(driver.address, 5);
    }

    const score = await reputation.getScore(driver.address);
    expect(score).to.be.lessThanOrEqual(100);
  });

  it("Rating out of range is rejected", async function () {
    // Rating of 6 (outside 1-5 range) should fail
    await expect(
      reputation.connect(customer).addPositiveRating(driver.address, 6)
    ).to.be.reverted;
  });
});