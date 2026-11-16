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

  it("enforces the timelock relative to the creation block (blockMin = creation + RELEASE_DELAY_BLOCKS)", async function () {
    const { escrow, owner, shipper, driver } = await deployEscrow();
    const secret = ethers.id("mev-secret-timelock");
    const secretHash = ethers.keccak256(ethers.solidityPacked(["bytes32"], [secret]));
    const amount = ethers.parseEther("1");

    const creationBlock = (await ethers.provider.getBlockNumber()) + 1;
    await escrow.connect(shipper).createProtectedDeposit(driver.address, secretHash, { value: amount });

    const dep = await escrow.deposits(1);
    // blockMin is fixed by the contract: creation block + RELEASE_DELAY_BLOCKS.
    const delay = await escrow.RELEASE_DELAY_BLOCKS();
    assert.equal(dep.blockMin, BigInt(creationBlock) + delay);
    assert.equal(await escrow.REFUND_WINDOW(), 5760n);

    await assertRejectsWith(
      escrow.connect(owner).releaseDepositPrivate(1, secret),
      "Release window not open"
    );

    await mine(Number(dep.blockMin) - (await ethers.provider.getBlockNumber()));

    const driverBefore = await ethers.provider.getBalance(driver.address);
    await escrow.connect(owner).releaseDepositPrivate(1, secret);
    const after = await escrow.deposits(1);
    assert.equal(after.released, true);
    assert.equal(await ethers.provider.getBalance(driver.address) - driverBefore, amount);
  });

  it("does not let the caller control the release window", async function () {
    const { escrow, shipper, driver } = await deployEscrow();
    const secretHash = ethers.keccak256(ethers.toUtf8Bytes("secret"));

    // createProtectedDeposit takes no blockMin argument: every deposit gets
    // exactly block.number + RELEASE_DELAY_BLOCKS, so neither an over-eager
    // nor an arbitrarily distant timelock can be supplied.
    const creationBlock = (await ethers.provider.getBlockNumber()) + 1;
    await escrow.connect(shipper).createProtectedDeposit(driver.address, secretHash, { value: ethers.parseEther("1") });

    const dep = await escrow.deposits(1);
    const delay = await escrow.RELEASE_DELAY_BLOCKS();
    assert.equal(dep.blockMin, BigInt(creationBlock) + delay);
  });
});
