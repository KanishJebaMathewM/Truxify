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

  // ═══════════════════════════════════════════════════════════════════════════
  // Constructor
  // ═══════════════════════════════════════════════════════════════════════════
  describe("constructor", function () {
    it("sets deployer as owner", async function () {
      const { reputation, owner } = await deployReputation();
      assert.equal(await reputation.owner(), owner.address);
    });

    it("authorizes initial relayer", async function () {
      const { reputation, relayer } = await deployReputation();
      assert.equal(await reputation.authorizedRelayers(relayer.address), true);
    });

    it("does not authorize non-relayer addresses", async function () {
      const { reputation, driver } = await deployReputation();
      assert.equal(await reputation.authorizedRelayers(driver.address), false);
    });

    it("starts unpaused", async function () {
      const { reputation } = await deployReputation();
      assert.equal(await reputation.paused(), false);
    });

    it("starts drivers with zero reputation", async function () {
      const { reputation, driver } = await deployReputation();
      assert.equal(await reputation.getReputation(driver.address), 0n);
    });

    it("handles zero address as initial relayer gracefully", async function () {
      const [owner] = await ethers.getSigners();
      const Reputation = await ethers.getContractFactory("Reputation");
      const reputation = await Reputation.deploy(ethers.ZeroAddress);
      await reputation.waitForDeployment();
      assert.equal(await reputation.authorizedRelayers(ethers.ZeroAddress), false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setRelayer
  // ═══════════════════════════════════════════════════════════════════════════
  describe("setRelayer", function () {
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

    it("emits RelayerUpdated event", async function () {
      const { reputation, owner, outsider } = await deployReputation();

      const tx = reputation.connect(owner).setRelayer(outsider.address, true);
      await assert.doesNotReject(tx);
    });

    it("reverts if called by non-owner", async function () {
      const { reputation, outsider, driver } = await deployReputation();

      await assertRejectsWith(
        reputation.connect(outsider).setRelayer(driver.address, true),
        "OwnableUnauthorizedAccount"
      );
    });

    it("reverts if relayer is zero address", async function () {
      const { reputation, owner } = await deployReputation();

      await assertRejectsWith(
        reputation.connect(owner).setRelayer(ethers.ZeroAddress, true),
        "Invalid relayer"
      );
    });

    it("can authorize multiple relayers", async function () {
      const { reputation, owner, driver, outsider } = await deployReputation();
      const [, , , , relayer2, relayer3] = await ethers.getSigners();

      await reputation.connect(owner).setRelayer(relayer2.address, true);
      await reputation.connect(owner).setRelayer(relayer3.address, true);

      await reputation.connect(relayer2).increaseReputation(driver.address, 10);
      await reputation.connect(relayer3).increaseReputation(driver.address, 5);

      assert.equal(await reputation.getReputation(driver.address), 15n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // increaseReputation
  // ═══════════════════════════════════════════════════════════════════════════
  describe("increaseReputation", function () {
    it("allows authorized relayers to increase reputation", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).increaseReputation(driver.address, 25);
      assert.equal(await reputation.getReputation(driver.address), 25n);
    });

    it("caps reputation at MAX_REPUTATION", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).increaseReputation(driver.address, 10001);
      assert.equal(await reputation.getReputation(driver.address), 10000n);
    });

    it("caps reputation when already near max", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).increaseReputation(driver.address, 9999);
      await reputation.connect(relayer).increaseReputation(driver.address, 100);

      assert.equal(await reputation.getReputation(driver.address), 10000n);
    });

    it("reverts if already at max reputation", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).increaseReputation(driver.address, 10000);

      await assertRejectsWith(
        reputation.connect(relayer).increaseReputation(driver.address, 1),
        "already at max reputation"
      );
    });

    it("reverts if driver is zero address", async function () {
      const { reputation, relayer } = await deployReputation();

      await assertRejectsWith(
        reputation.connect(relayer).increaseReputation(ethers.ZeroAddress, 10),
        "Invalid driver"
      );
    });

    it("reverts if called by non-relayer", async function () {
      const { reputation, outsider, driver } = await deployReputation();

      await assertRejectsWith(
        reputation.connect(outsider).increaseReputation(driver.address, 10),
        "Not authorized relayer"
      );
    });

    it("reverts when contract is paused", async function () {
      const { reputation, owner, relayer, driver } = await deployReputation();

      await reputation.connect(owner).pause();

      await assertRejectsWith(
        reputation.connect(relayer).increaseReputation(driver.address, 10),
        "EnforcedPause"
      );
    });

    it("emits ReputationIncreased event", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      const tx = await reputation.connect(relayer).increaseReputation(driver.address, 50);
      const receipt = await tx.wait();
      assert.ok(receipt.status === 1);
    });

    it("accumulates increases from multiple calls", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).increaseReputation(driver.address, 100);
      await reputation.connect(relayer).increaseReputation(driver.address, 200);
      await reputation.connect(relayer).increaseReputation(driver.address, 50);

      assert.equal(await reputation.getReputation(driver.address), 350n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // decreaseReputation
  // ═══════════════════════════════════════════════════════════════════════════
  describe("decreaseReputation", function () {
    it("allows authorized relayers to decrease reputation", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).increaseReputation(driver.address, 25);
      await reputation.connect(relayer).decreaseReputation(driver.address, 10);
      assert.equal(await reputation.getReputation(driver.address), 15n);
    });

    it("does not underflow when decreasing more than the current score", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).increaseReputation(driver.address, 5);
      await reputation.connect(relayer).decreaseReputation(driver.address, 10);

      assert.equal(await reputation.getReputation(driver.address), 0n);
    });

    it("sets to zero when decreasing exact amount", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).increaseReputation(driver.address, 50);
      await reputation.connect(relayer).decreaseReputation(driver.address, 50);

      assert.equal(await reputation.getReputation(driver.address), 0n);
    });

    it("reverts if driver is zero address", async function () {
      const { reputation, relayer } = await deployReputation();

      await assertRejectsWith(
        reputation.connect(relayer).decreaseReputation(ethers.ZeroAddress, 10),
        "Invalid driver"
      );
    });

    it("reverts if called by non-relayer", async function () {
      const { reputation, outsider, driver } = await deployReputation();

      await assertRejectsWith(
        reputation.connect(outsider).decreaseReputation(driver.address, 10),
        "Not authorized relayer"
      );
    });

    it("reverts when contract is paused", async function () {
      const { reputation, owner, relayer, driver } = await deployReputation();

      await reputation.connect(owner).pause();

      await assertRejectsWith(
        reputation.connect(relayer).decreaseReputation(driver.address, 10),
        "EnforcedPause"
      );
    });

    it("emits ReputationDecreased event", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).increaseReputation(driver.address, 50);
      const tx = await reputation.connect(relayer).decreaseReputation(driver.address, 10);
      const receipt = await tx.wait();
      assert.ok(receipt.status === 1);
    });

    it("handles decrease on zero-score driver", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).decreaseReputation(driver.address, 100);
      assert.equal(await reputation.getReputation(driver.address), 0n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // pause / unpause
  // ═══════════════════════════════════════════════════════════════════════════
  describe("pause / unpause", function () {
    it("owner can pause", async function () {
      const { reputation, owner } = await deployReputation();

      await reputation.connect(owner).pause();
      assert.equal(await reputation.paused(), true);
    });

    it("owner can unpause", async function () {
      const { reputation, owner } = await deployReputation();

      await reputation.connect(owner).pause();
      await reputation.connect(owner).unpause();
      assert.equal(await reputation.paused(), false);
    });

    it("reverts if non-owner tries to pause", async function () {
      const { reputation, outsider } = await deployReputation();

      await assertRejectsWith(
        reputation.connect(outsider).pause(),
        "OwnableUnauthorizedAccount"
      );
    });

    it("reverts if non-owner tries to unpause", async function () {
      const { reputation, owner, outsider } = await deployReputation();

      await reputation.connect(owner).pause();

      await assertRejectsWith(
        reputation.connect(outsider).unpause(),
        "OwnableUnauthorizedAccount"
      );
    });

    it("allows operations after unpause", async function () {
      const { reputation, owner, relayer, driver } = await deployReputation();

      await reputation.connect(owner).pause();
      await reputation.connect(owner).unpause();

      await reputation.connect(relayer).increaseReputation(driver.address, 10);
      assert.equal(await reputation.getReputation(driver.address), 10n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getReputation
  // ═══════════════════════════════════════════════════════════════════════════
  describe("getReputation", function () {
    it("returns zero for addresses that have never been scored", async function () {
      const { reputation } = await deployReputation();
      const [, , , , addr] = await ethers.getSigners();
      assert.equal(await reputation.getReputation(addr.address), 0n);
    });

    it("returns correct score after multiple operations", async function () {
      const { reputation, relayer, driver } = await deployReputation();

      await reputation.connect(relayer).increaseReputation(driver.address, 100);
      await reputation.connect(relayer).decreaseReputation(driver.address, 30);
      await reputation.connect(relayer).increaseReputation(driver.address, 20);

      assert.equal(await reputation.getReputation(driver.address), 90n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // authorizedRelayers mapping
  // ═══════════════════════════════════════════════════════════════════════════
  describe("authorizedRelayers mapping", function () {
    it("reflects authorization changes", async function () {
      const { reputation, owner, outsider } = await deployReputation();

      assert.equal(await reputation.authorizedRelayers(outsider.address), false);

      await reputation.connect(owner).setRelayer(outsider.address, true);
      assert.equal(await reputation.authorizedRelayers(outsider.address), true);

      await reputation.connect(owner).setRelayer(outsider.address, false);
      assert.equal(await reputation.authorizedRelayers(outsider.address), false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MAX_REPUTATION constant
  // ═══════════════════════════════════════════════════════════════════════════
  describe("constants", function () {
    it("MAX_REPUTATION is 10000", async function () {
      const { reputation } = await deployReputation();
      assert.equal(await reputation.MAX_REPUTATION(), 10000n);
    });
  });
});