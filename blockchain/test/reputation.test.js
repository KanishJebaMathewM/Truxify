import assert from "node:assert/strict";
import hre from "hardhat";
const { ethers } = hre;

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
});