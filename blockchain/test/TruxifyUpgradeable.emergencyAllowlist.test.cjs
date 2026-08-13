const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ONE_DAY = 86_400;

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

describe("TruxifyUpgradeable emergency upgrade allowlist", function () {
  let truxify, v2Implementation;
  let owner, upgrader, voter;

  beforeEach(async function () {
    [owner, upgrader, voter] = await ethers.getSigners();

    const TruxifyUpgradeable = await ethers.getContractFactory(
      "TruxifyUpgradeable"
    );
    const implementation = await TruxifyUpgradeable.deploy();
    await implementation.waitForDeployment();

    v2Implementation = await TruxifyUpgradeable.deploy();
    await v2Implementation.waitForDeployment();

    const UUPSProxy = await ethers.getContractFactory("UUPSProxy");
    const initializeData =
      implementation.interface.encodeFunctionData("initialize");
    const proxy = await UUPSProxy.deploy(
      await implementation.getAddress(),
      initializeData
    );
    await proxy.waitForDeployment();

    truxify = await ethers.getContractAt(
      "TruxifyUpgradeable",
      await proxy.getAddress()
    );

    await truxify.grantUpgraderRole(upgrader.address);
    await truxify.setApprovedImplementation(
      await v2Implementation.getAddress(),
      true
    );
  });

  it("rejects an emergency upgrade request for a non-allowlisted implementation", async function () {
    const nonApproved = voter.address;
    await expectRevert(
      truxify.connect(upgrader).requestEmergencyUpgrade(
        nonApproved,
        "Critical security fix"
      ),
      "Implementation not approved"
    );

    const requestTimestamp = await truxify.emergencyUpgradeRequests(
      nonApproved
    );
    expect(requestTimestamp).to.equal(0n);
  });

  it("allows requesting and executing an emergency upgrade for an allowlisted implementation", async function () {
    const v2Address = await v2Implementation.getAddress();

    await truxify.connect(upgrader).requestEmergencyUpgrade(
      v2Address,
      "Critical security fix"
    );
    expect(await truxify.emergencyUpgradeRequests(v2Address)).to.not.equal(0n);

    await time.increase(2 * ONE_DAY + 1);

    await truxify.connect(upgrader).upgradeToAndCall(v2Address, "0x");

    expect(await truxify.getUpgradeCount()).to.equal(1n);
    expect(await truxify.emergencyUpgradeRequests(v2Address)).to.equal(0n);
  });

  it("blocks an emergency upgrade whose allowlist entry was revoked during the timelock", async function () {
    const v2Address = await v2Implementation.getAddress();

    await truxify.connect(upgrader).requestEmergencyUpgrade(
      v2Address,
      "Critical security fix"
    );

    // The admin revokes the allowlist entry while the timelock runs.
    await truxify.setApprovedImplementation(v2Address, false);

    await time.increase(2 * ONE_DAY + 1);

    await expectRevert(
      truxify.connect(upgrader).upgradeToAndCall(v2Address, "0x"),
      "Implementation not approved"
    );
  });
});
