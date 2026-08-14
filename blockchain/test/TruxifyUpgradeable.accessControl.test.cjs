const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, (error) => error.message.includes(message));
}

describe("TruxifyUpgradeable escrow access control", function () {
  let truxify;
  let admin, driver, customer, attacker;

  beforeEach(async function () {
    [admin, driver, customer, attacker] = await ethers.getSigners();

    const TruxifyUpgradeable = await ethers.getContractFactory("TruxifyUpgradeable");
    const implementation = await TruxifyUpgradeable.deploy();
    await implementation.waitForDeployment();

    const UUPSProxy = await ethers.getContractFactory("UUPSProxy");
    const initializeData = implementation.interface.encodeFunctionData("initialize");
    const proxy = await UUPSProxy.deploy(await implementation.getAddress(), initializeData);
    await proxy.waitForDeployment();

    truxify = await ethers.getContractAt("TruxifyUpgradeable", await proxy.getAddress());
  });

  async function createEscrow() {
    const amount = ethers.parseEther("1");
    await truxify.connect(customer).createEscrow(driver.address, amount, { value: amount });
    return 1;
  }

  it("grants DEFAULT_ADMIN_ROLE to the initializer only", async function () {
    const adminRole = await truxify.DEFAULT_ADMIN_ROLE();
    assert.equal(await truxify.hasRole(adminRole, admin.address), true);
    assert.equal(await truxify.hasRole(adminRole, attacker.address), false);
  });

  it("rejects releaseEscrow from a non-admin address", async function () {
    const escrowId = await createEscrow();
    await assertRejectsWith(
      truxify.connect(attacker).releaseEscrow(escrowId),
      "AccessControl"
    );
    const escrow = await truxify.getEscrow(escrowId);
    assert.equal(escrow.released, false);
  });

  it("rejects disputeEscrow from a non-admin address", async function () {
    const escrowId = await createEscrow();
    await assertRejectsWith(
      truxify.connect(attacker).disputeEscrow(escrowId),
      "AccessControl"
    );
    const escrow = await truxify.getEscrow(escrowId);
    assert.equal(escrow.disputed, false);
  });

  it("rejects releaseEscrow from the customer even though they funded it", async function () {
    const escrowId = await createEscrow();
    await assertRejectsWith(
      truxify.connect(customer).releaseEscrow(escrowId),
      "AccessControl"
    );
  });

  it("allows the admin to release an escrow", async function () {
    const escrowId = await createEscrow();
    await truxify.connect(admin).releaseEscrow(escrowId);
    const escrow = await truxify.getEscrow(escrowId);
    assert.equal(escrow.released, true);
  });

  it("allows the admin to dispute an escrow", async function () {
    const escrowId = await createEscrow();
    await truxify.connect(admin).disputeEscrow(escrowId);
    const escrow = await truxify.getEscrow(escrowId);
    assert.equal(escrow.disputed, true);
  });

  it("keeps createEscrow permissionless so any customer can lock funds", async function () {
    const amount = ethers.parseEther("0.5");
    await truxify.connect(attacker).createEscrow(driver.address, amount, { value: amount });
    const escrow = await truxify.getEscrow(1);
    assert.equal(escrow.customer, attacker.address);
    assert.equal(escrow.amount, amount);
  });
});
