import assert from "node:assert/strict";
import hre from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
const { ethers } = hre;

async function assertRejectsWith(promise, message) {
  await assert.rejects(promise, error => error.message.includes(message));
}

describe("MEVProtectedEscrow blockMin timelock", function () {
  async function deployEscrow() {
    const [owner, shipper, driver] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("MEVProtectedEscrow");
    const escrow = await Escrow.deploy(owner.address);
    await escrow.waitForDeployment();
    return { escrow, owner, shipper, driver };
  }

  it("enforces the timelock relative to the release action time (not the creation block)", async function () {
    const { escrow, owner, shipper, driver } = await deployEscrow();
    const secret = ethers.id("mev-secret-timelock");
    const secretHash = ethers.keccak256(ethers.solidityPacked(["bytes32"], [secret]));
    const amount = ethers.parseEther("1");

    const current = await ethers.provider.getBlockNumber();
    const blockMin = current + 20;
    await escrow.connect(shipper).createProtectedDeposit(driver.address, secretHash, blockMin, { value: amount });

    const dep = await escrow.deposits(1);
    assert.equal(dep.blockMin, blockMin);
    assert.equal(dep.blockMax, blockMin + 5760);

    await assertRejectsWith(
      escrow.connect(owner).releaseDepositPrivate(1, secret),
      "Release window not open"
    );

    await mine(blockMin - (await ethers.provider.getBlockNumber()));

    const driverBefore = await ethers.provider.getBalance(driver.address);
    await escrow.connect(owner).releaseDepositPrivate(1, secret);
    const after = await escrow.deposits(1);
    assert.equal(after.released, true);
    assert.equal(await ethers.provider.getBalance(driver.address) - driverBefore, amount);
  });

  it("reverts when an out-of-bounds (too large) blockMin timelock is supplied", async function () {
    const { escrow, shipper, driver } = await deployEscrow();
    const secretHash = ethers.keccak256(ethers.toUtf8Bytes("secret"));
    const current = await ethers.provider.getBlockNumber();

    await assertRejectsWith(
      escrow.connect(shipper).createProtectedDeposit(driver.address, secretHash, current + (5760 + 1), { value: ethers.parseEther("1") }),
      "blockMin too far in the future"
    );
  });
});
