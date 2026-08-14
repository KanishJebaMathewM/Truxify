import assert from "node:assert/strict";
import hre from "hardhat";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, (error) => error.message.includes(message));
}

describe("MEVProtectedEscrow release window", function () {
  async function deployEscrow() {
    const [owner, shipper, driver] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("MEVProtectedEscrow");
    const escrow = await Escrow.deploy(owner.address);
    await escrow.waitForDeployment();
    return { escrow, owner, shipper, driver };
  }

  it("rejects release before the MEV release delay elapses", async function () {
    const { escrow, owner, shipper, driver } = await deployEscrow();
    const secret = ethers.id("mev-release-secret");
    const secretHash = ethers.keccak256(ethers.solidityPacked(["bytes32"], [secret]));
    const amount = ethers.parseEther("1");

    await escrow.connect(shipper).createProtectedDeposit(driver.address, secretHash, { value: amount });

    // The deposit was just created; blockMin is now creation block + RELEASE_DELAY_BLOCKS,
    // so a same-block release must be rejected (the guard is no longer a no-op).
    await assertRejectsWith(
      escrow.connect(owner).releaseDepositPrivate(1, secret),
      "Release window not open"
    );
  });
});
