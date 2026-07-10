const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

describe("Reputation", function () {
  async function deployReputation() {
    const [owner, relayer, driver, outsider] = await ethers.getSigners();
    const Reputation = await ethers.getContractFactory("Reputation");
    const reputation = await Reputation.deploy(relayer.address);
    await reputation.waitForDeployment();
    return { reputation, owner, relayer, driver, outsider };
  }

  it("starts drivers with zero reputation", async function () {
    const { reputation, driver } = await deployReputation();
    assert.equal(await reputation.getReputation(driver.address), 0n);
  });

  it("allows authorized relayers to increase and decrease reputation", async function () {
    const { reputation, relayer, driver } = await deployReputation();

    await reputation.connect(relayer).increaseReputation(driver.address, 25);
    assert.equal(await reputation.getReputation(driver.address), 25n);

    await reputation.connect(relayer).decreaseReputation(driver.address, 10);
    assert.equal(await reputation.getReputation(driver.address), 15n);
  });

  it("does not underflow when decreasing more than the current score", async function () {
    const { reputation, relayer, driver } = await deployReputation();

    await reputation.connect(relayer).increaseReputation(driver.address, 5);
    await reputation.connect(relayer).decreaseReputation(driver.address, 10);

    assert.equal(await reputation.getReputation(driver.address), 0n);
  });

  it("rejects unauthorized reputation updates", async function () {
    const { reputation, outsider, driver } = await deployReputation();

    await assertRejectsWith(
      reputation.connect(outsider).increaseReputation(driver.address, 1),
      "Not authorized relayer"
    );
  });

  it("lets the owner add and remove relayers", async function () {
    const { reputation, owner, outsider, driver } = await deployReputation();

    await reputation.connect(owner).setRelayer(outsider.address, true);
    await reputation.connect(outsider).increaseReputation(driver.address, 7);
    assert.equal(await reputation.getReputation(driver.address), 7n);

    await reputation.connect(owner).setRelayer(outsider.address, false);
    await assertRejectsWith(
      reputation.connect(outsider).increaseReputation(driver.address, 1),
      "Not authorized relayer"
    );
  });

  it("caps reputation at MAX_REPUTATION", async function () {
    const { reputation, relayer, driver } = await deployReputation();
    await reputation.connect(relayer).increaseReputation(driver.address, 9999);
    await reputation.connect(relayer).increaseReputation(driver.address, 100);
    assert.equal(await reputation.getReputation(driver.address), 10000n);
  });

  it("rejects zero-address driver in increase", async function () {
    const { reputation, relayer } = await deployReputation();
    await assertRejectsWith(
      reputation.connect(relayer).increaseReputation(ethers.ZeroAddress, 1),
      "Invalid driver"
    );
  });

  it("rejects zero-address driver in decrease", async function () {
    const { reputation, relayer } = await deployReputation();
    await assertRejectsWith(
      reputation.connect(relayer).decreaseReputation(ethers.ZeroAddress, 1),
      "Invalid driver"
    );
  });

  it("only owner can transfer ownership", async function () {
    const { reputation, owner, outsider } = await deployReputation();
    await assertRejectsWith(
      reputation.connect(outsider).transferOwnership(outsider.address),
      "Only owner"
    );
    await reputation.connect(owner).transferOwnership(outsider.address);
  });

  it("performs batch reputation increases", async function () {
    const { reputation, relayer } = await deployReputation();
    const [, , driver1, driver2, driver3] = await ethers.getSigners();
    const drivers = [driver1.address, driver2.address, driver3.address];
    const points = [10n, 20n, 30n];
    await reputation.connect(relayer).batchIncreaseReputation(drivers, points);
    assert.equal(await reputation.getReputation(driver1.address), 10n);
    assert.equal(await reputation.getReputation(driver2.address), 20n);
    assert.equal(await reputation.getReputation(driver3.address), 30n);
  });

  it("rejects batch with mismatched array lengths", async function () {
    const { reputation, relayer } = await deployReputation();
    const drivers = [relayer.address];
    const points = [1n, 2n];
    await assertRejectsWith(
      reputation.connect(relayer).batchIncreaseReputation(drivers, points),
      "Array length mismatch"
    );
  });
});
