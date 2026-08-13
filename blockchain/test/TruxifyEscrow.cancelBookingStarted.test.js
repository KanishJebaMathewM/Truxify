import hre from "hardhat";
const { ethers } = hre;
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// createBooking requires an owner-signed EIP-191 commitment over
<<<<<<< HEAD
// keccak256(abi.encodePacked(chainId, escrow, customer, bookingId, nonce)).
// The shared deployWithBooking fixture omits the signature, so this file keeps
// its own fixture to exercise cancelBooking's started-trip guard (issue #8891).
async function signCommitment(owner, escrow, customer, bookingId, nonce) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const commitment = ethers.solidityPackedKeccak256(
    ["uint256", "address", "address", "uint256", "uint256"],
    [chainId, await escrow.getAddress(), customer.address, bookingId, nonce]
=======
// keccak256(abi.encodePacked(chainId, escrow, customer, bookingId, driver,
// amount, nonce)). The shared deployWithBooking fixture omits the signature, so
// this file keeps its own fixture to exercise cancelBooking's started-trip guard
// (issue #8891). The driver and amount are pinned so a stale signature cannot be
// reused for a different driver/amount (issue #11393).
async function signCommitment(owner, escrow, customer, bookingId, driver, amount, nonce) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const commitment = ethers.solidityPackedKeccak256(
    ["uint256", "address", "address", "uint256", "address", "uint256", "uint256"],
    [chainId, await escrow.getAddress(), customer.address, bookingId, driver, amount, nonce]
>>>>>>> upstream/main
  );
  return owner.signMessage(ethers.getBytes(commitment));
}

describe("TruxifyEscrow #8891 — cancelBooking started-trip guard", function () {
  async function deployWithBookingFixture() {
    const [owner, customer, driver] = await ethers.getSigners();
    const TruxifyEscrow = await ethers.getContractFactory("TruxifyEscrow");
    const escrow = await TruxifyEscrow.deploy();

    const bookingId = 1n;
    const amount = ethers.parseEther("1.0");
<<<<<<< HEAD
    const signature = await signCommitment(owner, escrow, customer, bookingId, 0n);
=======
    const signature = await signCommitment(owner, escrow, customer, bookingId, driver.address, amount, 0n);
>>>>>>> upstream/main

    await escrow
      .connect(customer)
      .createBooking(bookingId, driver.address, signature, { value: amount });

    return { escrow, owner, customer, driver, bookingId, amount };
  }

  it("reverts cancelBooking once the trip has started", async function () {
    const { escrow, owner } = await loadFixture(deployWithBookingFixture);

    await escrow.connect(owner).markBookingStarted(1n);

    await expect(escrow.connect(owner).cancelBooking(1n)).to.be.revertedWith(
      "TruxifyEscrow: Trip already started"
    );
  });

  it("still refunds the customer in full for a not-started trip", async function () {
    const { escrow, owner, customer, amount } = await loadFixture(deployWithBookingFixture);

    await expect(escrow.connect(owner).cancelBooking(1n)).to.emit(escrow, "BookingCancelled");
    expect(await escrow.pendingWithdrawals(customer.address)).to.equal(amount);
  });

  it("cancelWithPenalty also rejects a started trip (consistent guard)", async function () {
    const { escrow, owner } = await loadFixture(deployWithBookingFixture);

    await escrow.connect(owner).markBookingStarted(1n);

    await expect(escrow.connect(owner).cancelWithPenalty(1n, ethers.parseEther("0.3"))).to.be
      .revertedWith("TruxifyEscrow: Trip already started");
  });
});
